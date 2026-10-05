import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CO_A = "a0000000-0000-0000-0000-000000000001", CO_B = "b0000000-0000-0000-0000-000000000001";
const S1 = "a1000000-0000-0000-0000-000000000001", S2 = "a1000000-0000-0000-0000-000000000002", SB = "b1000000-0000-0000-0000-000000000001";
const U = { office: id(1), mgr1: id(2), shift1: id(3), staff1: id(4), staff1b: id(5), staff2: id(6), officeB: id(7), gone1: id(8) };
const P = "c0000000-0000-0000-0000-000000000001"; // 11/16〜12/15

async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec(`select set_config('app.user_id','${user}',false); set role app_user;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const fails = async (sql: string) => { try { return ((await db.query(sql)).affectedRows ?? 0) === 0; } catch { return true; } };
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const work = (who: string, store: string, day: string, s = "10:00", e = "19:00") =>
  `insert into shifts (company_id, store_id, period_id, membership_id, day, kind, start_time, end_time) values ('${CO_A}','${store}','${P}','${who}','${day}','work','${s}','${e}')`;
const setStatus = (store: string, status: string) => db.exec(`update store_period_status set status='${status}' where period_id='${P}' and store_id='${store}'`);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations").sort()) await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.exec(`
    insert into companies (id, code, name) values ('${CO_A}','co-a','A'), ('${CO_B}','co-b','B');
    insert into stores (id, company_id, name) values ('${S1}','${CO_A}','店1'), ('${S2}','${CO_A}','店2'), ('${SB}','${CO_B}','B店');
    insert into memberships (id, company_id, store_id, employee_code, name, level, status) values
      ('${U.office}','${CO_A}','${S1}','1','オフィス',4,'active'), ('${U.mgr1}','${CO_A}','${S1}','2','店長1',3,'active'),
      ('${U.shift1}','${CO_A}','${S1}','3','シフト担当1',2,'active'), ('${U.staff1}','${CO_A}','${S1}','4','スタッフ1',1,'active'),
      ('${U.staff1b}','${CO_A}','${S1}','5','スタッフ1b',1,'active'), ('${U.staff2}','${CO_A}','${S2}','6','スタッフ2',1,'active'),
      ('${U.officeB}','${CO_B}','${SB}','1','B社オフィス',4,'active'), ('${U.gone1}','${CO_A}','${S1}','9','退職者',1,'disabled');
    insert into shift_periods (id, company_id, start_date, end_date, label) values ('${P}','${CO_A}','2026-11-16','2026-12-15','11/16〜12/15');
    insert into store_period_status (period_id, store_id, company_id) values ('${P}','${S1}','${CO_A}'), ('${P}','${S2}','${CO_A}');
  `);
});

describe("シフトを編集できる状態・人", () => {
  it("準備中は、オフィスでも編集できない", async () => {
    await as(U.office, async () => expect(await fails(work(U.staff1, S1, "2026-11-20"))).toBe(true));
  });
  it("作成中: シフト担当・店長は自店のみ編集できる。スタッフは編集できない", async () => {
    await setStatus(S1, "drafting"); await setStatus(S2, "drafting");
    await as(U.shift1, async () => {
      expect(await fails(work(U.staff1, S1, "2026-11-20"))).toBe(false);
      expect(await fails(work(U.staff2, S2, "2026-11-20"))).toBe(true);   // 他店は不可
    });
    await as(U.mgr1, async () => {
      expect(await fails(work(U.staff1b, S1, "2026-11-20"))).toBe(false);
      expect(await fails(work(U.staff2, S2, "2026-11-20"))).toBe(true);   // 店長も他店は不可
    });
    await as(U.staff1, async () => expect(await fails(work(U.staff1, S1, "2026-11-21"))).toBe(true));
    await as(U.office, async () => expect(await fails(work(U.staff2, S2, "2026-11-20"))).toBe(false)); // オフィスは全店
  });
  it("同じ人・同じ日は1件だけ（上書き更新はできる）", async () => {
    await as(U.shift1, async () => {
      expect(await fails(work(U.staff1, S1, "2026-11-20"))).toBe(true);
      expect(await fails(`update shifts set start_time='11:00', end_time='20:00' where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(false);
    });
  });
  it("確定後はシフト担当・店長は編集できない。オフィスはできる。確認済みは誰もできない", async () => {
    await setStatus(S1, "confirmed");
    await as(U.shift1, async () => expect(await fails(`update shifts set end_time='21:00' where membership_id='${U.staff1}'`)).toBe(true));
    await as(U.mgr1, async () => expect(await fails(`delete from shifts where membership_id='${U.staff1b}'`)).toBe(true));
    await as(U.office, async () => expect(await fails(`update shifts set end_time='20:00' where membership_id='${U.staff1}'`)).toBe(false));
    await setStatus(S1, "acknowledged");
    await as(U.office, async () => expect(await fails(`update shifts set end_time='21:00' where membership_id='${U.staff1}'`)).toBe(true));
    await setStatus(S1, "drafting");
  });
});

describe("入力の正しさ", () => {
  it("出勤は時間が必須で、退店は入店より後", async () => {
    await as(U.shift1, async () => {
      expect(await fails(work(U.staff1, S1, "2026-11-22", "19:00", "10:00"))).toBe(true);
      expect(await fails(work(U.staff1, S1, "2026-11-22", "10:00", "10:00"))).toBe(true);
      expect(await fails(`insert into shifts (company_id, store_id, period_id, membership_id, day, kind) values ('${CO_A}','${S1}','${P}','${U.staff1}','2026-11-22','work')`)).toBe(true);
    });
  });
  it("休み・有給・公休は時間なし（時間を付けるとエラー）", async () => {
    await as(U.shift1, async () => {
      for (const [i, k] of ["off", "paid", "holiday"].entries())
        expect(await fails(`insert into shifts (company_id, store_id, period_id, membership_id, day, kind) values ('${CO_A}','${S1}','${P}','${U.staff1}','2026-11-${23 + i}','${k}')`)).toBe(false);
      expect(await fails(`insert into shifts (company_id, store_id, period_id, membership_id, day, kind, start_time, end_time) values ('${CO_A}','${S1}','${P}','${U.staff1b}','2026-11-23','off','10:00','19:00')`)).toBe(true);
    });
  });
  it("期間外の日付・別の店の人・退職した人は入れられない", async () => {
    await as(U.shift1, async () => {
      expect(await fails(work(U.staff1b, S1, "2026-12-20"))).toBe(true);
      expect(await fails(work(U.staff2, S1, "2026-11-25"))).toBe(true);   // S2の人をS1のシフトに
      expect(await fails(work(U.gone1, S1, "2026-11-25"))).toBe(true);
    });
  });
  it("他社の人・他社の店には入れられない", async () => {
    await as(U.office, async () => {
      expect(await fails(`insert into shifts (company_id, store_id, period_id, membership_id, day, kind, start_time, end_time) values ('${CO_B}','${SB}','${P}','${U.officeB}','2026-11-25','work','10:00','19:00')`)).toBe(true);
    });
  });
});

describe("見られる範囲", () => {
  it("公開前: スタッフには見えない。シフト担当・店長・オフィスには見える（他社は見えない）", async () => {
    await as(U.staff1, async () => expect(await rows("select 1 from shifts")).toHaveLength(0));
    await as(U.shift1, async () => expect((await rows("select 1 from shifts")).length).toBeGreaterThan(0));
    await as(U.mgr1, async () => expect((await rows("select distinct store_id from shifts")).length).toBe(1)); // 他店は見えない
    await as(U.officeB, async () => expect(await rows("select 1 from shifts")).toHaveLength(0));
  });
  it("公開後: スタッフは自店舗のシフトだけ見える。他店は見えない", async () => {
    await setStatus(S1, "published");
    await as(U.staff1, async () => {
      const r = await rows("select distinct store_id from shifts");
      expect(r.map((x) => x.store_id)).toEqual([S1]);
    });
    await as(U.staff2, async () => expect(await rows("select 1 from shifts")).toHaveLength(0)); // 店2は未公開
  });
  it("公開後の変更は履歴に残る", async () => {
    await as(U.office, async () => {
      expect(await fails(`update shifts set end_time='20:30' where membership_id='${U.staff1}' and day='2026-11-20'`)).toBe(false);
      const logs = await rows("select detail from audit_logs where action = 'shift.update'");
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
