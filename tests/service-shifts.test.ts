import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
let periodId = "";
const id: Record<string, string> = {};
const st: Record<string, string> = {};

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st.s1); await mk("mgr1", "2", 3, st.s1); await mk("shift1", "3", 2, st.s1);
  await mk("a", "4", 1, st.s1); await mk("b", "5", 1, st.s1); await mk("c", "6", 1, st.s2);
  await svc.setOnShift(db, id.office, id.office, false);
  await svc.createNextPeriod(db, id.office, "2026-11-20"); // 11/16〜12/15
  periodId = (await svc.listPeriods(db, id.office))[0].id;
  await svc.setPeriodStatus(db, id.office, { periodId, storeId: st.s1, status: "collecting" });
  await svc.setPeriodStatus(db, id.office, { periodId, storeId: st.s2, status: "collecting" });
});

describe("シフト作成サービス", () => {
  it("シフト表に載る人: 自店舗の在籍者で「シフトに入る」人だけ（オフィスは外せる）", async () => {
    const names = (await svc.listRoster(db, id.shift1, st.s1)).map((r) => r.name);
    expect(names.sort()).toEqual(["a", "b", "mgr1", "shift1"]);
    await svc.setOnShift(db, id.mgr1, id.mgr1, false).catch(() => {}); // 自分は変えられないことがある
    await expect(svc.setOnShift(db, id.a, id.b, false)).rejects.toThrow(svc.ForbiddenError);                 // スタッフは不可
  });

  it("希望休を提出 → シフトに一括反映（休み/有給）。すでにあるシフトは上書きしない", async () => {
    await svc.toggleMyRequest(db, id.a, periodId, "2026-11-18");
    await svc.toggleMyRequest(db, id.a, periodId, "2026-11-19", "paid");
    await svc.setPeriodStatus(db, id.mgr1, { periodId, storeId: st.s1, status: "drafting" });
    expect(await svc.applyRequests(db, id.shift1, periodId, st.s1)).toBe(2);
    expect(await svc.applyRequests(db, id.shift1, periodId, st.s1)).toBe(0);  // 2回目は何も増えない
    const rows = await svc.listShifts(db, id.shift1, periodId, st.s1);
    expect(rows.map((r) => `${r.day}:${r.kind}`).sort()).toEqual(["2026-11-18:off", "2026-11-19:paid"]);
  });

  it("全員を基本時間で一括入力。希望休の人は休み、すでにある日は変えない", async () => {
    const n = await svc.fillDefault(db, id.shift1, { periodId, storeId: st.s1, days: ["2026-11-18", "2026-11-21"], start: "10:00", end: "19:00" });
    // 4人×2日 = 8 のうち、a の 11/18 は既存(休み)なので除外 → 7
    expect(n).toBe(7);
    const rows = await svc.listShifts(db, id.shift1, periodId, st.s1);
    const a18 = rows.find((r) => r.membershipId === id.a && r.day === "2026-11-18")!;
    expect(a18.kind).toBe("off");
    const b21 = rows.find((r) => r.membershipId === id.b && r.day === "2026-11-21")!;
    expect([b21.kind, b21.start, b21.end]).toEqual(["work", "10:00", "19:00"]);
  });

  it("一人だけ個別に変更できる（早退など）。同じ日は上書き", async () => {
    await svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21", kind: "work", start: "10:00", end: "15:00" }]);
    const b21 = (await svc.listShifts(db, id.shift1, periodId, st.s1)).find((r) => r.membershipId === id.b && r.day === "2026-11-21")!;
    expect(b21.end).toBe("15:00");
    // 一括入力をもう一度（上書きなし）しても、個別に直した分は変わらない
    await svc.fillDefault(db, id.shift1, { periodId, storeId: st.s1, days: ["2026-11-21"], start: "10:00", end: "19:00" });
    expect((await svc.listShifts(db, id.shift1, periodId, st.s1)).find((r) => r.membershipId === id.b && r.day === "2026-11-21")!.end).toBe("15:00");
  });

  it("入力のまちがいは、やさしいメッセージで断られる", async () => {
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-25", kind: "work", start: "19:00", end: "10:00" }])).rejects.toThrow("退店は入店より後");
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-25", kind: "work" }])).rejects.toThrow("時間を入れて");
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day: "2027-02-01", kind: "off" }])).rejects.toThrow("期間の外");
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.c, day: "2026-11-25", kind: "off" }])).rejects.toThrow("このお店");
  });

  it("1件でも失敗したら全部取り消される", async () => {
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [
      { membershipId: id.a, day: "2026-11-26", kind: "off" }, { membershipId: id.a, day: "2027-02-01", kind: "off" }])).rejects.toThrow();
    expect((await svc.listShifts(db, id.shift1, periodId, st.s1)).some((r) => r.day === "2026-11-26")).toBe(false);
  });

  it("他店のシフトは作れない（店長でも）。見るだけ", async () => {
    await expect(svc.saveShifts(db, id.mgr1, periodId, st.s2, [{ membershipId: id.c, day: "2026-11-25", kind: "off" }])).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.canEditShifts(db, id.mgr1, periodId, st.s2)).toBe(false);
    expect(await svc.canEditShifts(db, id.mgr1, periodId, st.s1)).toBe(true);
    await svc.setPeriodStatus(db, id.office, { periodId, storeId: st.s2, status: "drafting" });
    await svc.saveShifts(db, id.office, periodId, st.s2, [{ membershipId: id.c, day: "2026-11-25", kind: "off" }]);
    expect((await svc.listShifts(db, id.mgr1, periodId, st.s2))).toHaveLength(1);
  });

  it("消せる。確定すると、店長・シフト担当は変更も削除もできない", async () => {
    expect(await svc.clearShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21" }])).toBe(1);
    await svc.setPeriodStatus(db, id.mgr1, { periodId, storeId: st.s1, status: "confirmed" });
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21", kind: "off" }])).rejects.toThrow("変更できません");
    await expect(svc.clearShifts(db, id.mgr1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-21" }])).rejects.toThrow("変更できません");
    await svc.saveShifts(db, id.office, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21", kind: "off" }]); // オフィスは可
  });

  it("公開すると、スタッフは自店舗のシフトが見られる。公開前は見えない", async () => {
    expect(await svc.listShifts(db, id.a, periodId, st.s1)).toHaveLength(0);
    await svc.setPeriodStatus(db, id.mgr1, { periodId, storeId: st.s1, status: "published" });
    expect((await svc.listShifts(db, id.a, periodId, st.s1)).length).toBeGreaterThan(5);
    expect(await svc.listShifts(db, id.a, periodId, st.s2)).toHaveLength(0);
  });

  it("お店の基本時間はオフィスだけが変えられる", async () => {
    await expect(svc.setStoreHours(db, id.mgr1, st.s1, "09:00", "20:00")).rejects.toThrow(svc.ForbiddenError);
    await svc.setStoreHours(db, id.office, st.s1, "09:00", "20:00");
    expect((await svc.listStores(db, id.office)).find((s) => s.id === st.s1)).toMatchObject({ defaultOpen: "09:00", defaultClose: "20:00" });
    await expect(svc.setStoreHours(db, id.office, st.s1, "20:00", "09:00")).rejects.toThrow("正しくありません");
  });
});

describe("休憩ルールの設定", () => {
  it("初期値は「上限8時間・段階なし」", async () => {
    expect((await svc.getMe(db, id.mgr1))?.breakRule).toEqual({ capMinutes: 480, tiers: [] });
  });
  it("変更できるのはオフィスだけ。保存したルールは全員に反映され、履歴が残る", async () => {
    const rule = { capMinutes: 480, tiers: [{ overMinutes: 480, breakMinutes: 60 }, { overMinutes: 360, breakMinutes: 45 }] };
    await expect(svc.setBreakRule(db, id.mgr1, rule)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setBreakRule(db, id.shift1, rule)).rejects.toThrow(svc.ForbiddenError);
    await svc.setBreakRule(db, id.office, rule);
    const m = await svc.getMe(db, id.a);
    expect(m?.breakRule.tiers).toEqual([{ overMinutes: 360, breakMinutes: 45 }, { overMinutes: 480, breakMinutes: 60 }]); // 並べ替えて保存
    expect((await db.query("select 1 from audit_logs where action = 'company.break_rule'")).rows).toHaveLength(1);
  });
  it("おかしな値は保存できない。元に戻せる（初期値）", async () => {
    await expect(svc.setBreakRule(db, id.office, { capMinutes: 5, tiers: [] })).rejects.toThrow("上限");
    await svc.setBreakRule(db, id.office, { capMinutes: 480, tiers: [] });
    expect((await svc.getMe(db, id.office))?.breakRule).toEqual({ capMinutes: 480, tiers: [] });
  });
});
