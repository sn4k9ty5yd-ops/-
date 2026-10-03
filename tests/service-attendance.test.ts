import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { pgliteDatabase } from "../lib/db/adapters";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
let periodId = "";
const id: Record<string, string> = {};
const st: Record<string, string> = {};
const get = async (u: string, s = st.s1) => (await svc.listAttendance(db, u, periodId, s)).rows;
const find = (rows: svc.AttendanceRow[], who: string, day: string) => rows.find((r) => r.membershipId === id[who] && r.day === day);

beforeAll(async () => {
  db = pgliteDatabase(new PGlite());
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st.s1); await mk("mgr1", "2", 3, st.s1); await mk("shift1", "3", 2, st.s1);
  await mk("a", "4", 1, st.s1); await mk("b", "5", 1, st.s1); await mk("c", "6", 1, st.s2); await mk("mgr2", "7", 3, st.s2);
  await svc.setOnShift(db, id.office, id.office, false);
  await svc.createNextPeriod(db, id.office, "2026-11-20");           // 11/16〜12/15
  periodId = (await svc.listPeriods(db, id.office))[0].id;
  for (const s of [st.s1, st.s2]) await svc.setPeriodStatus(db, id.office, { periodId, storeId: s, status: "drafting" });
  // シフト: 11/16〜11/17 を全員 10-19、b の 11/17 は有給
  await svc.fillDefault(db, id.shift1, { periodId, storeId: st.s1, days: ["2026-11-16", "2026-11-17"], start: "10:00", end: "19:00" });
  await svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-17", kind: "paid" }]);
});

describe("出勤簿の入力", () => {
  it("シフトから下書きを作る（出勤→時間と休憩が自動、有給→有給）", async () => {
    const n = await svc.draftAttendanceFromShifts(db, id.mgr1, periodId, st.s1);
    expect(n).toBe(8);
    const rows = await get(id.mgr1);
    expect(find(rows, "a", "2026-11-16")).toMatchObject({ kind: "work", clockIn: "10:00", clockOut: "19:00", breakMin: 60, workMin: 480, edited: false, source: "shift" });
    expect(find(rows, "b", "2026-11-17")).toMatchObject({ kind: "paid", workMin: 0 });
  });
  it("もう一度作っても変わらない（上書きなし）", async () => {
    expect(await svc.draftAttendanceFromShifts(db, id.mgr1, periodId, st.s1)).toBe(0);
  });
  it("一人ずつ直す（早退）。休憩は自動計算・理由メモ・「個別に直した」目印", async () => {
    await svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-16", kind: "work", clockIn: "10:00", clockOut: "15:00", note: "早退（子どもの体調不良）" }]);
    expect(find(await get(id.mgr1), "a", "2026-11-16")).toMatchObject({ clockOut: "15:00", breakMin: 0, workMin: 300, note: "早退（子どもの体調不良）", edited: true });
  });
  it("休憩を手で指定もできる。在店より長い休憩・おかしな時間は断る", async () => {
    await svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-16", kind: "work", clockIn: "10:00", clockOut: "19:00", breakMin: 90 }]);
    expect(find(await get(id.mgr1), "b", "2026-11-16")?.workMin).toBe(450);
    await expect(svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-16", kind: "work", clockIn: "10:00", clockOut: "11:00", breakMin: 90 }])).rejects.toThrow("在店時間より長く");
    await expect(svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-16", kind: "work", clockIn: "19:00", clockOut: "10:00" }])).rejects.toThrow("退店は入店より後");
    await expect(svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.b, day: "2026-12-30", kind: "off" }])).rejects.toThrow("期間の外");
  });
  it("一括入力: 複数日・全員。シフトで休みの人は除く。個別に直した日は上書きしない", async () => {
    const r = await svc.fillAttendance(db, id.mgr1, { periodId, storeId: st.s1, days: ["2026-11-16", "2026-11-17", "2026-11-18"], clockIn: "09:30", clockOut: "18:30" });
    // 4人×3日=12 − 休み/有給(b 11/17)=1 − 個別に直した(a 11/16, b 11/16)=2 → 9
    expect(r).toEqual({ saved: 9, skippedEdited: 2 });
    const rows = await get(id.mgr1);
    expect(find(rows, "a", "2026-11-16")?.clockOut).toBe("15:00");            // 個別分は変わらない
    expect(find(rows, "b", "2026-11-17")?.kind).toBe("paid");                  // 有給は変わらない
    expect(find(rows, "a", "2026-11-18")).toMatchObject({ clockIn: "09:30", clockOut: "18:30", source: "bulk", edited: false });
  });
  it("「上書きする」を選べば、個別に直した日も上書きされる", async () => {
    const r = await svc.fillAttendance(db, id.mgr1, { periodId, storeId: st.s1, days: ["2026-11-16"], clockIn: "10:00", clockOut: "19:00", overwrite: true });
    expect(r.saved).toBe(4);
    expect(find(await get(id.mgr1), "a", "2026-11-16")).toMatchObject({ clockOut: "19:00", edited: false });
  });
  it("消せる", async () => {
    expect(await svc.clearAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-18" }])).toBe(1);
    expect(find(await get(id.mgr1), "a", "2026-11-18")).toBeUndefined();
  });
});

describe("見られる人・直せる人", () => {
  it("シフト担当・スタッフは見えない・書けない", async () => {
    for (const u of [id.shift1, id.a]) {
      expect(await get(u)).toEqual([]);
      await expect(svc.saveAttendance(db, u, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-19", kind: "off" }])).rejects.toThrow(svc.ForbiddenError);
    }
  });
  it("店長は他店の出勤簿は見られるが直せない。オフィスは全店", async () => {
    await svc.saveAttendance(db, id.office, periodId, st.s2, [{ membershipId: id.c, day: "2026-11-16", kind: "work", clockIn: "10:00", clockOut: "19:00" }]);
    expect((await get(id.mgr1, st.s2)).length).toBe(1);
    await expect(svc.saveAttendance(db, id.mgr1, periodId, st.s2, [{ membershipId: id.c, day: "2026-11-17", kind: "off" }])).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.listAttendance(db, id.mgr1, periodId, st.s2)).editable).toBe(false);
  });
  it("休憩ルールを変えると、これから入力する分に新ルールが使われる（保存済みは変わらない）", async () => {
    await svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-19", kind: "work", clockIn: "10:00", clockOut: "19:00", breakMin: 90 }]);
    await svc.setBreakRule(db, id.office, { capMinutes: 480, tiers: [{ overMinutes: 360, breakMinutes: 45 }] });
    await svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-19", kind: "work", clockIn: "10:00", clockOut: "17:00" }]);
    const rows = await get(id.mgr1);
    expect(find(rows, "a", "2026-11-19")?.breakMin).toBe(45);
    expect(find(rows, "b", "2026-11-19")?.breakMin).toBe(90);                  // 以前に保存した分は変わらない
    await svc.setBreakRule(db, id.office, { capMinutes: 480, tiers: [] });
  });
});

describe("提出と確認", () => {
  it("店長が提出 → 店長は直せない。オフィスは直せて、確認済みにできる。店長は確認済みにできない", async () => {
    await svc.setAttendanceStatus(db, id.mgr1, periodId, st.s1, "submitted");
    expect((await svc.listPeriods(db, id.mgr1))[0].stores.find((s) => s.storeId === st.s1)?.attendanceStatus).toBe("submitted");
    await expect(svc.saveAttendance(db, id.mgr1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-20", kind: "off" }])).rejects.toThrow("提出済み");
    await svc.saveAttendance(db, id.office, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-20", kind: "off" }]);
    await expect(svc.setAttendanceStatus(db, id.mgr1, periodId, st.s1, "acknowledged")).rejects.toThrow(svc.ForbiddenError);
    await svc.setAttendanceStatus(db, id.office, periodId, st.s1, "acknowledged");
    await expect(svc.saveAttendance(db, id.office, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-21", kind: "off" }])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setAttendanceStatus(db, id.mgr1, periodId, st.s1, "open")).rejects.toThrow(svc.ForbiddenError);
    await svc.setAttendanceStatus(db, id.office, periodId, st.s1, "open"); // オフィスは戻せる
  });
});

describe("有給の残り日数", () => {
  it("店長が付与 → 出勤簿で「有給」にした日が自動で引かれる。本人にも残りが見える", async () => {
    await svc.addLeaveGrant(db, id.mgr1, { membershipId: id.b, days: 10, note: "入社時の付与" });
    expect((await svc.getMyLeave(db, id.b))).toEqual({ membershipId: id.b, granted: 10, used: 1, remaining: 9 });   // 11/17 有給の1日
    await svc.addLeaveGrant(db, id.mgr1, { membershipId: id.b, days: -0.5, note: "調整" });
    expect((await svc.getMyLeave(db, id.b))?.remaining).toBe(8.5);
    expect((await svc.listLeaveHistory(db, id.b, id.b)).map((h) => h.days)).toEqual([-0.5, 10]);
  });
  it("付与できるのは店長(自店)とオフィス。シフト担当・スタッフ・他店の店長は不可。0.5日きざみ", async () => {
    await expect(svc.addLeaveGrant(db, id.shift1, { membershipId: id.a, days: 5 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addLeaveGrant(db, id.a, { membershipId: id.a, days: 5 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addLeaveGrant(db, id.mgr2, { membershipId: id.a, days: 5 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addLeaveGrant(db, id.mgr1, { membershipId: id.a, days: 0 })).rejects.toThrow("0.5 日きざみ");
    await expect(svc.addLeaveGrant(db, id.mgr1, { membershipId: id.a, days: 1.3 })).rejects.toThrow("0.5 日きざみ");
    await svc.addLeaveGrant(db, id.office, { membershipId: id.c, days: 12 });
  });
  it("スタッフは自分の残りだけ。店長は自店の全員分。一覧に履歴の詳細は出ない", async () => {
    expect((await svc.listLeave(db, id.b, st.s1)).map((x) => x.membershipId)).toEqual([id.b]);
    expect((await svc.listLeave(db, id.mgr1, st.s1)).length).toBe(5);   // 自店の在籍者全員
    expect(await svc.listLeave(db, id.a, st.s2)).toEqual([]);
    expect(await svc.getMyLeave(db, id.a)).toMatchObject({ granted: 0, used: 0, remaining: 0 });
  });
});
