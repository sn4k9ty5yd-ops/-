import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";

let db: Database;
const id: Record<string, string> = {}; const st: Record<string, string> = {};
let P = "";

beforeAll(async () => {
  db = await newDb(); await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('cm-co','C') returning id")).rows[0].id;
  for (const n of ["天神", "オルガン", "福津"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) => (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st["天神"]); await mk("shift", "2", 2, st["天神"]); await mk("shiftO", "3", 2, st["オルガン"]); await mk("a", "4", 1, st["天神"]);
  await mk("boss", "5", 1, st["天神"]); await mk("yaku", "6", 1, st["福津"]);
  await svc.createNextPeriod(db, id.office, "2026-11-20");
  P = (await svc.listPeriods(db, id.office))[0].id;
  for (const s of Object.values(st)) await db.query("update store_period_status set status = 'collecting' where period_id = $1 and store_id = $2", [P, s]);
});

describe("カレンダーだけの人（社長・役員）", () => {
  it("決められるのは正美さん(レベル4)だけ。お店と日にちが要る", async () => {
    const stints = [{ storeId: st["天神"], fromDay: 16, toDay: 31 }, { storeId: st["オルガン"], fromDay: 1, toDay: 15 }];
    await expect(svc.setCalendarMember(db, id.shift, id.boss, true, stints)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setCalendarMember(db, id.office, id.boss, true, [])).rejects.toThrow("1つ以上");
    await expect(svc.setCalendarMember(db, id.office, id.boss, true, [{ storeId: st["天神"], fromDay: 20, toDay: 10 }])).rejects.toThrow();
    await svc.setCalendarMember(db, id.office, id.boss, true, stints);
    await svc.setCalendarMember(db, id.office, id.yaku, true, [{ storeId: st["福津"], fromDay: 1, toDay: 31 }]);
  });
  it("出勤するお店の名簿に出る（出勤簿の名簿には出ない）", async () => {
    const t = await svc.listRoster(db, id.shift, st["天神"]);
    expect(t.find((r) => r.id === id.boss)).toMatchObject({ calendarOnly: true, stints: [{ fromDay: 16, toDay: 31 }] });
    expect((await svc.listRoster(db, id.shiftO, st["オルガン"])).find((r) => r.id === id.boss)?.stints).toEqual([{ fromDay: 1, toDay: 15 }]);
    expect((await svc.listRoster(db, id.shift, st["福津"])).some((r) => r.id === id.boss)).toBe(false);
    expect((await svc.listAttendanceRoster(db, id.shift, P, st["天神"])).some((r) => r.id === id.boss)).toBe(false);   // 出勤簿には入らない
  });
  it("シフト担当が、その店の休みを入れられる。出勤は入れられない。出勤しないお店には入れられない", async () => {
    await svc.saveShifts(db, id.shift, P, st["天神"], [{ membershipId: id.boss, day: "2026-11-20", kind: "holiday" }]);
    await svc.saveShifts(db, id.shiftO, P, st["オルガン"], [{ membershipId: id.boss, day: "2026-12-05", kind: "off" }]);
    expect((await svc.listShifts(db, id.shift, P, st["天神"])).find((r) => r.membershipId === id.boss)?.kind).toBe("holiday");
    await expect(svc.saveShifts(db, id.shift, P, st["天神"], [{ membershipId: id.boss, day: "2026-11-21", kind: "work", start: "10:00", end: "19:00" }])).rejects.toThrow();
    await expect(svc.saveShifts(db, id.shift, P, st["天神"], [{ membershipId: id.yaku, day: "2026-11-21", kind: "holiday" }])).rejects.toThrow();   // 福津だけの人を、天神に入れられない
    await expect(svc.saveShifts(db, id.shift, P, st["天神"], [{ membershipId: id.a, day: "2026-11-22", kind: "holiday" }])).resolves.toBe(1);              // ふつうの人は、今までどおり
  });
  it("ふつうの人にもどすと、名簿から消える", async () => {
    await svc.setCalendarMember(db, id.office, id.yaku, false, []);
    expect((await svc.listRoster(db, id.shift, st["福津"])).some((r) => r.id === id.yaku)).toBe(false);
  });
});
