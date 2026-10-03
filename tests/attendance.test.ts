import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CO_A = "a0000000-0000-0000-0000-000000000001", CO_B = "b0000000-0000-0000-0000-000000000001";
const S1 = "a1000000-0000-0000-0000-000000000001", S2 = "a1000000-0000-0000-0000-000000000002", SB = "b1000000-0000-0000-0000-000000000001";
const U = { office: id(1), mgr1: id(2), mgr2: id(3), shift1: id(4), staff1: id(5), staff1b: id(6), staff2: id(7), officeB: id(8) };
const P = "c0000000-0000-0000-0000-000000000001"; // 11/16〜12/15

async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec(`select set_config('app.user_id','${user}',false); set role app_user;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const fails = async (sql: string) => { try { return ((await db.query(sql)).affectedRows ?? 0) === 0; } catch { return true; } };
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const work = (who: string, store: string, day: string, i = "10:00", o = "19:00", br = 60) =>
  `insert into attendance_records (company_id, store_id, period_id, membership_id, day, kind, clock_in, clock_out, break_minutes) values ('${CO_A}','${store}','${P}','${who}','${day}','work','${i}','${o}',${br})`;
const att = (store: string, s: string) => db.exec(`update store_period_status set attendance_status='${s}' where period_id='${P}' and store_id='${store}'`);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations").sort()) await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.exec(`
    insert into companies (id, code, name) values ('${CO_A}','co-a','A'), ('${CO_B}','co-b','B');
    insert into stores (id, company_id, name) values ('${S1}','${CO_A}','店1'), ('${S2}','${CO_A}','店2'), ('${SB}','${CO_B}','B店');
    insert into memberships (id, company_id, store_id, employee_code, name, level) values
      ('${U.office}','${CO_A}','${S1}','1','オフィス',4), ('${U.mgr1}','${CO_A}','${S1}','2','店長1',3), ('${U.mgr2}','${CO_A}','${S2}','3','店長2',3),
      ('${U.shift1}','${CO_A}','${S1}','4','シフト担当',2), ('${U.staff1}','${CO_A}','${S1}','5','スタッフ1',1), ('${U.staff1b}','${CO_A}','${S1}','6','スタッフ1b',1),
      ('${U.staff2}','${CO_A}','${S2}','7','スタッフ2',1), ('${U.officeB}','${CO_B}','${SB}','1','B社オフィス',4);
    insert into shift_periods (id, company_id, start_date, end_date, label) values ('${P}','${CO_A}','2026-11-16','2026-12-15','11/16〜12/15');
    insert into store_period_status (period_id, store_id, company_id) values ('${P}','${S1}','${CO_A}'), ('${P}','${S2}','${CO_A}');
  `);
});

describe("出勤簿を書ける人・見られる人", () => {
  it("スタッフ・シフト担当は書けない／見えない（自分の分も）", async () => {
    for (const u of [U.staff1, U.shift1]) await as(u, async () => expect(await fails(work(U.staff1, S1, "2026-11-20"))).toBe(true));
  });
  it("店長は自店を書ける・直せる。他店は書けない（見るだけ）", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(work(U.staff1, S1, "2026-11-20"))).toBe(false);
      expect(await fails(work(U.staff2, S2, "2026-11-20"))).toBe(true);
      expect(await fails(`update attendance_records set clock_out='20:00', break_minutes=120 where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(false);
    });
    await as(U.mgr2, async () => expect(await fails(work(U.staff2, S2, "2026-11-20"))).toBe(false));
    await as(U.mgr1, async () => expect((await rows("select distinct store_id from attendance_records")).length).toBe(2)); // 他店も見られる
  });
  it("オフィスは全店。他社は何も見えない・書けない", async () => {
    await as(U.office, async () => expect(await fails(work(U.staff2, S2, "2026-11-21"))).toBe(false));
    await as(U.officeB, async () => {
      expect(await rows("select 1 from attendance_records")).toHaveLength(0);
      expect(await fails(work(U.staff1, S1, "2026-11-22"))).toBe(true);
    });
    await as(U.staff1, async () => expect(await rows("select 1 from attendance_records")).toHaveLength(0));
    await as(U.shift1, async () => expect(await rows("select 1 from attendance_records")).toHaveLength(0));
  });
});

describe("入力の正しさ", () => {
  it("実働は 退勤−入店−休憩 で自動計算される", async () => {
    const r = await rows(`select work_minutes from attendance_records where membership_id='${U.staff1}' and day='2026-11-20'`);
    expect(r[0].work_minutes).toBe(480);                       // 10:00-20:00 休憩120 → 8:00
    await db.exec(`insert into attendance_records (company_id, store_id, period_id, membership_id, day, kind) values ('${CO_A}','${S1}','${P}','${U.staff1}','2026-11-23','paid')`);
    expect((await rows(`select work_minutes from attendance_records where day='2026-11-23'`))[0].work_minutes).toBe(0);
  });
  it("入店より前の退勤・休憩が在店より長い・時間なしの出勤は不可。休みに時間は付けられない", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(work(U.staff1b, S1, "2026-11-24", "19:00", "10:00"))).toBe(true);
      expect(await fails(work(U.staff1b, S1, "2026-11-24", "10:00", "11:00", 90))).toBe(true);
      expect(await fails(`insert into attendance_records (company_id, store_id, period_id, membership_id, day, kind) values ('${CO_A}','${S1}','${P}','${U.staff1b}','2026-11-24','work')`)).toBe(true);
      expect(await fails(`insert into attendance_records (company_id, store_id, period_id, membership_id, day, kind, clock_in, clock_out) values ('${CO_A}','${S1}','${P}','${U.staff1b}','2026-11-24','off','10:00','19:00')`)).toBe(true);
    });
  });
  it("期間外の日付・別の店の人・同じ日の二重登録は不可", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(work(U.staff1b, S1, "2026-12-30"))).toBe(true);
      expect(await fails(work(U.staff2, S1, "2026-11-25"))).toBe(true);
      expect(await fails(work(U.staff1, S1, "2026-11-20"))).toBe(true);
    });
  });
});

describe("提出と確認", () => {
  it("提出後は店長は直せない。オフィスは直せる。確認済みは誰も直せない", async () => {
    await as(U.mgr1, async () => expect(await fails(`update store_period_status set attendance_status='submitted' where period_id='${P}' and store_id='${S1}'`)).toBe(false));
    await as(U.mgr1, async () => {
      expect(await fails(`update attendance_records set note='x' where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(true);
      expect(await fails(`delete from attendance_records where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(true);
      expect(await fails(work(U.staff1b, S1, "2026-11-26"))).toBe(true);
    });
    await as(U.office, async () => expect(await fails(`update attendance_records set note='オフィス修正' where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(false));
    await att(S1, "acknowledged");
    await as(U.office, async () => expect(await fails(`update attendance_records set note='もう一度' where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(true));
    await att(S1, "open");
  });
  it("店長は「確認済み」にできない・後戻りできない。オフィスはできる。履歴が残る", async () => {
    await as(U.mgr2, async () => {
      expect(await fails(`update store_period_status set attendance_status='acknowledged' where period_id='${P}' and store_id='${S2}'`)).toBe(true);
      expect(await fails(`update store_period_status set attendance_status='submitted' where period_id='${P}' and store_id='${S2}'`)).toBe(false);
      expect(await fails(`update store_period_status set attendance_status='open' where period_id='${P}' and store_id='${S2}'`)).toBe(true);
    });
    await as(U.office, async () => {
      expect(await fails(`update store_period_status set attendance_status='acknowledged' where period_id='${P}' and store_id='${S2}'`)).toBe(false);
      expect(await fails(`update store_period_status set attendance_status='open' where period_id='${P}' and store_id='${S2}'`)).toBe(false);
      expect((await rows("select 1 from audit_logs where action = 'attendance.status'")).length).toBeGreaterThanOrEqual(4);
    });
  });
  it("出勤簿の変更はすべて履歴に残る", async () => {
    await as(U.office, async () => {
      const logs = await rows("select action from audit_logs where action like 'attendance.%' and action <> 'attendance.status'");
      expect(logs.length).toBeGreaterThanOrEqual(5);
      expect(logs.map((l) => l.action)).toContain("attendance.update");
    });
    await as(U.mgr1, async () => expect(await rows("select 1 from audit_logs")).toHaveLength(0));
  });
});

describe("有給の残り日数（手で入れる方式）", () => {
  const grant = (who: string, store: string, days: number, note = "") => `insert into paid_leave_grants (company_id, store_id, membership_id, days, note) values ('${CO_A}','${store}','${who}',${days},'${note}')`;
  it("付与できるのは、店長（自店）とオフィス（全店）だけ", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(grant(U.staff1, S1, 10, "入社時"))).toBe(false);
      expect(await fails(grant(U.staff2, S2, 10))).toBe(true);
    });
    for (const u of [U.staff1, U.shift1]) await as(u, async () => expect(await fails(grant(U.staff1, S1, 5))).toBe(true));
    await as(U.office, async () => expect(await fails(grant(U.staff2, S2, 8))).toBe(false));
    await as(U.officeB, async () => expect(await fails(grant(U.staff1, S1, 5))).toBe(true));
  });
  it("0日・範囲外は不可。履歴は直せない・消せない（マイナスの調整で直す）", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(grant(U.staff1, S1, 0))).toBe(true);
      expect(await fails(`update paid_leave_grants set days = 99 where membership_id='${U.staff1}'`)).toBe(true);
      expect(await fails(`delete from paid_leave_grants where membership_id='${U.staff1}'`)).toBe(true);
      expect(await fails(grant(U.staff1, S1, -1, "調整"))).toBe(false);
    });
  });
  it("残り = 付与の合計 − 出勤簿の「有給」の日数。本人は自分の分だけ見える", async () => {
    // staff1: 付与 10 − 1 = 9、有給消化は 2026-11-23 の1日
    await as(U.staff1, async () => {
      const r = await rows(`select * from app.leave_balances('${S1}')`);
      expect(r).toHaveLength(1);
      expect(r[0].membership_id).toBe(U.staff1); expect(Number(r[0].used)).toBe(1);
      expect(Number(r[0].granted)).toBe(9); expect(Number(r[0].remaining)).toBe(8);
      expect(await rows("select 1 from paid_leave_grants")).toHaveLength(2);  // 自分の履歴(10, -1)のみ
    });
    await as(U.mgr1, async () => expect((await rows(`select * from app.leave_balances('${S1}')`)).length).toBe(5)); // 自店の在籍者全員
    await as(U.staff1b, async () => expect(await rows("select 1 from paid_leave_grants")).toHaveLength(0));
  });
  it("他店の残りは、スタッフには見えない。他社は見えない", async () => {
    await as(U.staff1, async () => expect(await rows(`select * from app.leave_balances('${S2}')`)).toHaveLength(0));
    await as(U.officeB, async () => expect(await rows(`select * from app.leave_balances('${S1}')`)).toHaveLength(0));
  });
});
