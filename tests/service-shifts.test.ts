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

  it("休憩を手で決めて保存でき、空にすると自動に戻る・範囲外は断る", async () => {
    const day = "2026-11-23";
    await svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day, kind: "work", start: "10:00", end: "19:00", breakMin: 30 }]);
    let r = (await svc.listShifts(db, id.shift1, periodId, st.s1)).find((x) => x.membershipId === id.a && x.day === day);
    expect(r?.breakMin).toBe(30);
    await svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day, kind: "work", start: "10:00", end: "19:00" }]);
    r = (await svc.listShifts(db, id.shift1, periodId, st.s1)).find((x) => x.membershipId === id.a && x.day === day);
    expect(r?.breakMin).toBeNull();
    await expect(svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day, kind: "work", start: "10:00", end: "19:00", breakMin: 700 }])).rejects.toThrow();
    await svc.clearShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day }]);
  });

  it("希望休を、公休／有給を選んで出し、出し直しで種類が変わり、取り消せる", async () => {
    await svc.setMyRequest(db, id.b, periodId, "2026-11-22", "hope");
    await svc.setMyRequest(db, id.b, periodId, "2026-11-22", "paid");
    let r = (await svc.listRequests(db, id.b, periodId)).filter((x) => x.membershipId === id.b && x.day === "2026-11-22");
    expect(r.map((x) => x.kind)).toEqual(["paid"]);
    await svc.setMyRequest(db, id.b, periodId, "2026-11-22", null);
    r = (await svc.listRequests(db, id.b, periodId)).filter((x) => x.membershipId === id.b && x.day === "2026-11-22");
    expect(r).toHaveLength(0);
  });

  it("希望休を提出 → シフトに一括反映（休み/有給）。すでにあるシフトは上書きしない", async () => {
    await svc.toggleMyRequest(db, id.a, periodId, "2026-11-18");
    await svc.toggleMyRequest(db, id.a, periodId, "2026-11-19", "paid");
    await db.query("update store_period_status set status = \'drafting\' where period_id = $1 and store_id = $2", [periodId, st.s1]);   // 自動の下書きなしで「作成中」にする
    expect(await svc.applyRequests(db, id.shift1, periodId, st.s1)).toBe(2);
    expect(await svc.applyRequests(db, id.shift1, periodId, st.s1)).toBe(0);  // 2回目は何も増えない
    const rows = await svc.listShifts(db, id.shift1, periodId, st.s1);
    expect(rows.map((r) => `${r.day}:${r.kind}`).sort()).toEqual(["2026-11-18:holiday", "2026-11-19:paid"]);
  });

  it("全員を基本時間で一括入力。希望休の人は休み、すでにある日は変えない", async () => {
    const n = await svc.fillDefault(db, id.shift1, { periodId, storeId: st.s1, days: ["2026-11-18", "2026-11-21"], start: "10:00", end: "19:00" });
    // 4人×2日 = 8 のうち、a の 11/18 は既存(休み)なので除外 → 7
    expect(n).toBe(7);
    const rows = await svc.listShifts(db, id.shift1, periodId, st.s1);
    const a18 = rows.find((r) => r.membershipId === id.a && r.day === "2026-11-18")!;
    expect(a18.kind).toBe("holiday");
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
    await db.query("update store_period_status set status = \'drafting\' where period_id = $1 and store_id = $2", [periodId, st.s2]);   // 自動の下書きなしで「作成中」にする
    await svc.saveShifts(db, id.office, periodId, st.s2, [{ membershipId: id.c, day: "2026-11-25", kind: "off" }]);
    expect((await svc.listShifts(db, id.mgr1, periodId, st.s2))).toHaveLength(0);   // 他店は見えない
    expect((await svc.listShifts(db, id.office, periodId, st.s2))).toHaveLength(1);
  });

  it("消せる。確定・公開したあとも、店長・シフト担当は直せる（変更があるため）。確認済みは直せない", async () => {
    expect(await svc.clearShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21" }])).toBe(1);
    await svc.setPeriodStatus(db, id.mgr1, { periodId, storeId: st.s1, status: "confirmed" });
    await svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21", kind: "off" }]);
    expect(await svc.clearShifts(db, id.mgr1, periodId, st.s1, [{ membershipId: id.a, day: "2026-11-21" }])).toBeGreaterThanOrEqual(0);
    await svc.saveShifts(db, id.office, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21", kind: "off" }]); // オフィスも可
    await expect(svc.saveShifts(db, id.a, periodId, st.s1, [{ membershipId: id.b, day: "2026-11-21", kind: "work", start: "10:00", end: "19:00" }])).rejects.toThrow();   // スタッフは不可
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

describe("休みの上限・かぶりの知らせ・話し合い", () => {
  it("シフト担当が上限を決め、超えた日が分かり、かぶっている人にお知らせが届き、話し合える。確定は、かぶりがあると止まる", async () => {
    await svc.createNextPeriod(db, id.office, "2026-12-20");                    // 12/16〜1/15（まだ確定していない新しい期間）
    const periodId = (await svc.listPeriods(db, id.office))[0].id;
    await db.query("update store_period_status set status = \'drafting\' where period_id = $1 and store_id = $2", [periodId, st.s1]);   // 自動の下書きなしで「作成中」にする
    const day = "2026-12-24";
    await svc.saveShifts(db, id.shift1, periodId, st.s1, [{ membershipId: id.a, day, kind: "holiday" }, { membershipId: id.b, day, kind: "paid" }]);
    await expect(svc.setDayLimits(db, id.a, periodId, st.s1, [day], 1)).rejects.toThrow(svc.ForbiddenError);           // スタッフは決められない
    expect(await svc.setDayLimits(db, id.shift1, periodId, st.s1, [day], 1)).toBe(1);
    await expect(svc.setDayLimits(db, id.shift1, periodId, st.s1, ["2030-01-01"], 1)).rejects.toThrow("期間の外");
    expect(await svc.listDayLimits(db, id.a, periodId, st.s1)).toEqual([{ day, maxOff: 1 }]);                         // 自店のスタッフは上限が見える
    expect(await svc.listConflicts(db, id.shift1, periodId, st.s1)).toEqual([{ day, maxOff: 1, count: 2 }]);
    expect(await svc.listConflicts(db, id.a, periodId, st.s1)).toEqual([]);                                           // スタッフには、一覧は出ない
    // 知らせる
    expect(await svc.notifyConflicts(db, id.shift1, periodId, st.s1)).toEqual({ days: 1, people: 2 });
    await expect(svc.notifyConflicts(db, id.a, periodId, st.s1)).rejects.toThrow(svc.ForbiddenError);
    const mine = await svc.listNotifications(db, id.a);
    const conflictItems = mine.items.filter((n) => n.kind === "conflict");           // （シフト公開のお知らせも入っている）
    expect(conflictItems).toHaveLength(1);
    expect(conflictItems[0].title).toContain("休みがかぶっています");
    expect((await svc.listNotifications(db, id.c)).items).toHaveLength(0);                                            // 関係ない人には届かない
    // 話し合い
    const info = await svc.getDayInfo(db, id.a, periodId, st.s1, day);
    expect(info.people.map((p) => p.name).sort()).toEqual(["a", "b"]);
    await svc.postDayMessage(db, id.a, periodId, st.s1, day, "私が譲ります");
    await expect(svc.getDayInfo(db, id.c, periodId, st.s1, day)).rejects.toThrow();                                   // 他店のスタッフは読めない
    await expect(svc.postDayMessage(db, id.c, periodId, st.s1, day, "のぞき見")).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.getDayInfo(db, id.b, periodId, st.s1, day)).messages.map((m) => m.body)).toEqual(["私が譲ります"]);
    expect((await svc.listNotifications(db, id.b)).items.some((i) => i.kind === "message")).toBe(true);
    await svc.markNotificationsRead(db, id.a);
    expect((await svc.listNotifications(db, id.a)).unread).toBe(0);
    // 確定は、かぶりがあると止まる（無理に確定もできる）
    await expect(svc.setPeriodStatus(db, id.mgr1, { periodId, storeId: st.s1, status: "confirmed" })).rejects.toThrow("休みがかぶっている日があります");
    await svc.setDayLimits(db, id.shift1, periodId, st.s1, [day], 2);
    await svc.setPeriodStatus(db, id.mgr1, { periodId, storeId: st.s1, status: "confirmed" });
  });

  it("出勤簿づくりを始めると、シフトカレンダー（休み・有給）が自動で反映され、ほかの日は営業時間で出勤になる。一括の直しは休みの人を変えない", async () => {
    const sp = (await db.query<{ id: string }>("insert into stores (company_id, name, default_open, default_close, sat_open, sat_close) select company_id, 'auto', '10:00','19:00','10:00','20:00' from stores where id = $1 returning id", [st.s1])).rows[0].id;
    const mem = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) select company_id, $1, '77', 'auto1', 1 from stores where id = $1 returning id", [sp])).rows[0].id;
    await db.query("update store_period_status set status = 'collecting' where period_id = $1 and store_id = $2", [periodId, sp]);
    await svc.setMyRequest(db, mem, periodId, "2026-11-18", "hope");
    await svc.setMyRequest(db, mem, periodId, "2026-11-19", "paid");
    await svc.setPeriodStatus(db, id.office, { periodId, storeId: sp, status: "closed" });
    await svc.setPeriodStatus(db, id.office, { periodId, storeId: sp, status: "drafting" });   // 自動で反映される
    const rows = await svc.listShifts(db, id.office, periodId, sp);
    expect(rows.length).toBe(30);                                                               // 11/16〜12/15 の全日
    const at = (d: string) => rows.find((r) => r.day === d)!;
    expect(at("2026-11-18").kind).toBe("holiday");
    expect(at("2026-11-19").kind).toBe("paid");
    expect(at("2026-11-20")).toMatchObject({ kind: "work", start: "10:00", end: "19:00" });     // 平日
    expect(at("2026-11-21")).toMatchObject({ kind: "work", start: "10:00", end: "20:00" });     // 土曜は土曜の時間
    // 一括の直し（休み・有給の人は変えない）
    await svc.fillDefault(db, id.office, { periodId, storeId: sp, days: ["2026-11-18", "2026-11-20"], start: "11:00", end: "20:00", overwrite: true, keepOff: true });
    const after = await svc.listShifts(db, id.office, periodId, sp);
    expect(after.find((r) => r.day === "2026-11-20")).toMatchObject({ start: "11:00", end: "20:00" });
    expect(after.find((r) => r.day === "2026-11-18")?.kind).toBe("holiday");
    expect(await svc.autoDraftShifts(db, id.office, periodId, sp)).toBe(0);                     // 2回目は何も増えない
  });

  it("受付から直接シフトづくりへ進める。確定すると出勤簿確定が自動で作られ、閉店30分後に直していない日は店長・シフト担当にだけ通知が1回届く", async () => {
    const sp = (await db.query<{ id: string }>("insert into stores (company_id, name, default_open, default_close) select company_id, 'rem', '10:00','19:00' from stores where id = $1 returning id", [st.s1])).rows[0].id;
    const mk2 = async (code: string, level: number) => (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) select company_id, $1, $2, $3, $4 from stores where id = $1 returning id", [sp, code, `r${code}`, level])).rows[0].id;
    const mgr = await mk2("81", 3), staff = await mk2("82", 1);
    await db.query("update store_period_status set status = 'collecting' where period_id = $1 and store_id = $2", [periodId, sp]);
    await svc.setPeriodStatus(db, id.office, { periodId, storeId: sp, status: "drafting" });         // 「受付おわり」を飛ばせる
    await svc.setPeriodStatus(db, id.office, { periodId, storeId: sp, status: "confirmed" });
    const att = await svc.listAttendance(db, id.office, periodId, sp);
    expect(att.rows.length).toBeGreaterThan(0);                                                       // 出勤簿確定が、自動でできている
    const day = "2026-11-24";
    expect(att.rows.some((r) => r.day === day && r.kind === "work")).toBe(true);
    const before = await svc.runCloseTimeReminders(db, true, `${day}T19:20:00.000Z`);
    expect(before.stores).toBe(0);                                                                    // 閉店30分前は、まだ
    const r1 = await svc.runCloseTimeReminders(db, true, `${day}T19:31:00.000Z`);
    expect(r1.stores).toBe(1);
    expect((await svc.listNotifications(db, mgr)).items.some((n) => n.title.includes("今日の退店時間を登録してください"))).toBe(true);
    expect((await svc.listNotifications(db, staff)).items.length).toBe(0);                            // 一般スタッフには届かない
    expect((await svc.runCloseTimeReminders(db, true, `${day}T19:45:00.000Z`)).stores).toBe(0);     // その日は1回だけ
    // 登録した印があれば、通知は来ない
    await svc.confirmAttendanceDay(db, mgr, sp, "2026-11-25");
    expect((await svc.runCloseTimeReminders(db, true, "2026-11-25T20:00:00.000Z")).stores).toBe(0);
    await expect(svc.confirmAttendanceDay(db, staff, sp, "2026-11-26")).rejects.toThrow(svc.ForbiddenError);
  });
});
