import { beforeAll, describe, expect, it } from "vitest";
import { daysOf } from "../lib/labels";
import { login } from "../lib/auth/login";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};
const count = async () => Number((await db.query<{ n: string }>("select count(*) as n from memberships")).rows[0].n);

beforeAll(async () => {
  db = await newDb(); await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "9000", 4, st.s1); await mk("mgr1", "1001", 3, st.s1); await mk("shift1", "1002", 2, st.s1); await mk("staff", "1003", 1, st.s1);
});

const row = (name: string, code: string, store = "s1", level: 1 | 2 | 3 | 4 = 1) => ({ name, employeeCode: code, storeId: st[store], level });

describe("スタッフのまとめて登録", () => {
  it("管理者: 全員を一度に登録。全員のパスコードが返り、そのパスコードでログインできる", async () => {
    const r = await svc.addStaffBulk(db, id.office, [row("大坪", "2001"), row("永尾", "2002"), row("店長太郎", "2003", "s2", 3)]);
    expect(r.count).toBe(3);
    expect(r.created.every((c) => /^\d{6}$/.test(c.passcode))).toBe(true);
    expect(new Set(r.created.map((c) => c.passcode)).size).toBeGreaterThan(1);
    for (const c of r.created) expect((await login(db, { companyCode: "x-co", employeeCode: c.employeeCode, passcode: c.passcode })).ok).toBe(true);
    const staff = await svc.listStaff(db, id.office);
    expect(staff.find((s) => s.employeeCode === "2003")).toMatchObject({ storeId: st.s2, name: "店長太郎" });
  });
  it("チェックだけ(dryRun): 何も作らず、履歴も残さない。問題があれば、同じように断る", async () => {
    const before = await count();
    const logs = Number((await db.query<{ n: string }>("select count(*) as n from audit_logs")).rows[0].n);
    expect(await svc.addStaffBulk(db, id.office, [row("確認用", "3001")], true)).toEqual({ count: 1, created: [] });
    expect(await count()).toBe(before);
    expect(Number((await db.query<{ n: string }>("select count(*) as n from audit_logs")).rows[0].n)).toBe(logs);
    await expect(svc.addStaffBulk(db, id.mgr1, [row("確認用", "3002", "s2")], true)).rejects.toThrow(svc.ForbiddenError);
  });
  it("店長: 自分のお店のスタッフ(レベル1)だけ登録できる。他のお店・上のレベルは、全員取り消し", async () => {
    await svc.addStaffBulk(db, id.mgr1, [row("店A1", "4001"), row("店A2", "4002")]);
    const before = await count();
    await expect(svc.addStaffBulk(db, id.mgr1, [row("店A3", "4003"), row("他店", "4004", "s2")])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addStaffBulk(db, id.mgr1, [row("店A5", "4005"), row("昇格", "4006", "s1", 2)])).rejects.toThrow("権限");
    expect(await count()).toBe(before);                                     // 途中までも作られていない
    expect((await svc.listStaff(db, id.office)).some((s) => s.employeeCode === "4003" || s.employeeCode === "4005")).toBe(false);
  });
  it("シフト担当・スタッフは登録できない", async () => {
    for (const u of [id.shift1, id.staff]) await expect(svc.addStaffBulk(db, u, [row("だれか", "5001")])).rejects.toThrow(svc.ForbiddenError);
  });
  it("やさしい言葉で断る: すでにある社員番号・表の中の重複・英数字以外・多すぎ・空", async () => {
    await expect(svc.addStaffBulk(db, id.office, [row("A", "2001")])).rejects.toThrow("すでに使われています");
    await expect(svc.addStaffBulk(db, id.office, [row("A", "6001"), row("B", "6001")])).rejects.toThrow("2回出てきます");
    await expect(svc.addStaffBulk(db, id.office, [row("A", "あ-1")])).rejects.toThrow("英数字");
    await expect(svc.addStaffBulk(db, id.office, [row("", "6002")])).rejects.toThrow("名前");
    await expect(svc.addStaffBulk(db, id.office, [])).rejects.toThrow("登録する人がいません");
    await expect(svc.addStaffBulk(db, id.office, Array.from({ length: 101 }, (_, i) => row(`n${i}`, `7${i}`)))).rejects.toThrow("100人まで");
  });
  it("別の会社には登録できない（他社のお店を指定しても）", async () => {
    const co2 = (await db.query<{ id: string }>("insert into companies (code, name) values ('y-co','Y') returning id")).rows[0].id;
    const other = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'他社店') returning id", [co2])).rows[0].id;
    await expect(svc.addStaffBulk(db, id.office, [{ name: "侵入", employeeCode: "8001", storeId: other, level: 1 }])).rejects.toThrow(svc.ForbiddenError);
  });
  it("同じ社員番号でも、別の会社なら使える", async () => {
    const co3 = (await db.query<{ id: string }>("insert into companies (code, name) values ('z-co','Z') returning id")).rows[0].id;
    const s3 = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'Z店') returning id", [co3])).rows[0].id;
    const o3 = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'9000','Zオフィス',4) returning id", [co3, s3])).rows[0].id;
    await svc.addStaffBulk(db, o3, [{ name: "Z1", employeeCode: "2001", storeId: s3, level: 1 }]);   // x-co にも 2001 がある
  });
  it("表示専用アカウント（お店のiPad）: 管理者が登録でき、レベル1・シフトに入らず、ログインできる", async () => {
    const r = await svc.addStaffBulk(db, id.office, [{ name: "s1 iPad", employeeCode: "9101", storeId: st.s1, level: 1, displayOnly: true }, row("普通の人", "9102")]);
    expect(r.created.map((c) => [c.displayOnly, c.level])).toEqual([[true, 1], [false, 1]]);
    const l = await login(db, { companyCode: "x-co", employeeCode: "9101", passcode: r.created[0].passcode });
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(await svc.getMe(db, l.membershipId)).toMatchObject({ displayOnly: true, level: 1, name: "s1 iPad" });
    expect((await svc.listStaff(db, id.office)).find((s) => s.employeeCode === "9101")).toMatchObject({ displayOnly: true, onShift: false });
    expect((await svc.listRoster(db, id.mgr1, st.s1)).some((x) => x.name === "s1 iPad")).toBe(false);          // シフト表に載らない
    expect((await svc.listRoster(db, id.mgr1, st.s1)).some((x) => x.name === "普通の人")).toBe(true);
    await expect(svc.setOnShift(db, id.office, l.membershipId, true)).rejects.toThrow(svc.ForbiddenError);    // シフトに入れられない
  });
  it("表示専用は、見るだけ: 希望休を出せない・登録・変更の権限がない", async () => {
    const l = (await db.query<{ id: string }>("select id from memberships where employee_code = '9101'")).rows[0].id;
    await svc.createNextPeriod(db, id.office, "2026-11-20");
    const p = (await svc.listPeriods(db, id.office))[0];
    await svc.setDayLimits(db, id.office, p.id, st.s1, daysOf(p.start, p.end), 3);
    await svc.setPeriodStatus(db, id.office, { periodId: p.id, storeId: st.s1, status: "collecting" });
    await expect(svc.toggleMyRequest(db, l, p.id, "2026-11-20")).rejects.toThrow("見るだけ");
    await expect(svc.addStaffBulk(db, l, [row("x", "9103")])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addStore(db, l, "勝手な店")).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.listStaff(db, l)).toBeTruthy();                                                              // お店の人の名前は見える（スタッフと同じ）
  });
  it("表示専用アカウントを作れるのは管理者だけ（店長は、まとめて登録でも作れない・全員取り消し）", async () => {
    const before = await count();
    await expect(svc.addStaffBulk(db, id.mgr1, [row("普通", "9201"), { name: "端末", employeeCode: "9202", storeId: st.s1, level: 1, displayOnly: true }])).rejects.toThrow(svc.ForbiddenError);
    expect(await count()).toBe(before);
  });
});
