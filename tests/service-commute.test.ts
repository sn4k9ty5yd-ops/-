import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
describe("定期券の提出", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {};
  const ym = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('c-co','C') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string) => { u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id; };
    await mk("office", "1", 4, sid.a); await mk("mgrA", "2", 3, sid.a); await mk("s1", "3", 1, sid.a); await mk("s2", "4", 1, sid.a); await mk("mgrB", "5", 3, sid.b); await mk("t1", "6", 1, sid.b);
  });
  it("名簿に入れられるのは、店長(自店)と正美さん。ふつうのスタッフ・他店の店長は不可", async () => {
    await expect(svc.setCommuteRoster(d, u.s2, u.s1, true)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setCommuteRoster(d, u.mgrB, u.s1, true)).rejects.toThrow(svc.ForbiddenError);
    await svc.setCommuteRoster(d, u.mgrA, u.s1, true);
    await svc.setCommuteRoster(d, u.office, u.t1, true);
    expect((await svc.getCommute(d, u.mgrA)).rows.map((r) => r.name)).toEqual(["s1"]);
    expect((await svc.getCommute(d, u.mgrB)).rows.map((r) => r.name)).toEqual(["t1"]);   // 他店の人は見えない
  });
  it("名簿に入っている人だけが出せる。名簿に入っていない人には、画面も出ない", async () => {
    expect(await svc.getCommuteSummary(d, u.s2)).toMatchObject({ show: false });
    expect(await svc.getCommuteSummary(d, u.s1)).toMatchObject({ show: true, pending: true });
    await expect(svc.submitCommute(d, u.s2, ym, IMG, 3)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.submitCommute(d, u.s1, ym, "x", 3)).rejects.toThrow("写真");
    await expect(svc.submitCommute(d, u.s1, ym, IMG, 2)).rejects.toThrow("何ヶ月");
    await svc.submitCommute(d, u.s1, ym, IMG, 3);
    expect((await svc.getCommute(d, u.s1)).mine).toMatchObject({ months: 3 });
    expect((await svc.getCommute(d, u.s1)).mine?.status).toBe("submitted");
  });
  it("写真を見られるのは、本人と正美さんだけ。確認すると本人に通知。確認ずみは出し直せない", async () => {
    const row = (await svc.getCommute(d, u.mgrA)).rows[0];
    await expect(svc.getCommuteImage(d, u.mgrA, row.subId!)).rejects.toThrow(svc.ForbiddenError);   // 店長は写真は見えない
    await expect(svc.getCommuteImage(d, u.s2, row.subId!)).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.getCommuteImage(d, u.s1, row.subId!)).toBe(IMG);
    expect(await svc.getCommuteImage(d, u.office, row.subId!)).toBe(IMG);
    await expect(svc.checkCommute(d, u.mgrA, row.subId!, "checked")).rejects.toThrow(svc.ForbiddenError);
    await svc.checkCommute(d, u.office, row.subId!, "redo", "見づらい");
    expect((await svc.getCommute(d, u.s1)).mine).toMatchObject({ status: "redo", note: "見づらい" });
    await svc.submitCommute(d, u.s1, ym, IMG, 3);
    await svc.checkCommute(d, u.office, row.subId!, "checked");
    await expect(svc.submitCommute(d, u.s1, ym, IMG, 3)).rejects.toThrow("確認ずみ");
  });
  it("名前を貼って照合できる（お店の見出し・漢字のゆれ）。店長は自店の人だけ入れられる", async () => {
    await d.query("update memberships set name = '金子 崇史' where id = $1", [u.s2]);
    await d.query("update memberships set name = '廣 茉紀' where id = $1", [u.t1]);
    const m = await svc.matchCommuteNames(d, u.office, "a店\nb\n金子嵩\n広\n見つからない人");
    expect(m.find((x) => x.token === "金子嵩")?.matches.map((x) => x.id)).toEqual([u.s2]);
    expect(m.find((x) => x.token === "広")?.matches.map((x) => x.id)).toEqual([u.t1]);
    expect(m.find((x) => x.token === "見つからない人")?.matches).toHaveLength(0);
    await expect(svc.matchCommuteNames(d, u.s1, "x")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addCommuteRosterBulk(d, u.mgrA, [u.t1])).rejects.toThrow(svc.ForbiddenError);   // 他店の人
    expect(await svc.addCommuteRosterBulk(d, u.mgrA, [u.s2])).toBe(1);
    await svc.setCommuteRoster(d, u.mgrA, u.s2, false);
  });
  it("3・6ヶ月定期は、その期間のあいだ、出さなくてよい（通知も来ない）", async () => {
    await svc.setCommuteRoster(d, u.office, u.s2, true);
    await svc.submitCommute(d, u.s2, ym, IMG, 6);
    const prev = new Date(`${ym}-01T00:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() + 1);
    const next = prev.toISOString().slice(0, 7);
    const sub = (await d.query<{ id: string }>("select id from commute_submissions where membership_id = $1", [u.s2])).rows[0].id;
    await svc.checkCommute(d, u.office, sub, "checked");
    // 来月: まだ期間の中 → 出さなくてよい
    expect((await svc.getCommute(d, u.s2, next)).coveredUntil).not.toBeNull();
    await d.query("update commute_submissions set month = (month - interval '1 month')::date where membership_id = $1", [u.s2]);   // 先月に出したことにして、今月を見る
    const g = await svc.getCommute(d, u.s2);
    expect(g.coveredUntil).not.toBeNull();
    expect((await svc.getCommuteSummary(d, u.s2)).pending).toBe(false);
    await svc.setCommuteRoster(d, u.office, u.s2, false);
  });
  it("外すと、名簿から消える。期限日は正美さんだけが決められる。通知は期限の3日前から、出していない人へ毎日1回", async () => {
    await expect(svc.setCommuteDue(d, u.mgrA, 20)).rejects.toThrow(svc.ForbiddenError);
    await svc.setCommuteDue(d, u.office, 20);
    expect((await svc.getCommute(d, u.office)).dueDay).toBe(20);
    const day = (n: number) => `${ym}-${String(n).padStart(2, "0")}T10:00:00.000Z`;
    expect((await svc.runCommuteReminders(d, true, day(10))).sent).toBe(0);   // 3日前より前
    await svc.runCommuteReminders(d, true, day(17));
    const n = async () => (await d.query<{ n: number }>("select count(*)::int as n from notifications where kind = 'commute' and user_id = $1", [u.t1])).rows[0].n;
    expect(await n()).toBe(1);
    await svc.runCommuteReminders(d, true, day(17));   // 同じ日は、2回送らない
    expect(await n()).toBe(1);
    await svc.runCommuteReminders(d, true, day(22));   // 期限をすぎても続く
    expect(await n()).toBe(2);
    expect((await d.query("select 1 from notifications where kind='commute' and user_id = $1 and title like '%すぎて%'", [u.t1])).rows).toHaveLength(1);
    expect((await d.query("select 1 from notifications where kind='commute' and user_id = $1 and title like '%すぎて%'", [u.s1])).rows).toHaveLength(0);   // s1は確認ずみ
    await svc.setCommuteRoster(d, u.mgrA, u.s1, false);
    expect((await svc.getCommute(d, u.mgrA)).rows).toHaveLength(0);
  });
});
