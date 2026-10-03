import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CO_A = "a0000000-0000-0000-0000-000000000001", CO_B = "b0000000-0000-0000-0000-000000000001";
const S1 = "a1000000-0000-0000-0000-000000000001", S2 = "a1000000-0000-0000-0000-000000000002", SB = "b1000000-0000-0000-0000-000000000001";
const U = { office: id(1), mgr1: id(2), shift1: id(3), staff1: id(4), staff1b: id(5), staff2: id(6), mgr2: id(7), officeB: id(8), staffB: id(9) };
const P = "c0000000-0000-0000-0000-000000000001";   // 11/16〜12/15
const PB = "c0000000-0000-0000-0000-000000000002";

async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec(`select set_config('app.user_id','${user}',false); set role app_user;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const admin0 = () => db.exec("select set_config('app.user_id','',false)");
const fails = async (sql: string) => { try { return ((await db.query(sql)).affectedRows ?? 0) === 0; } catch { return true; } };
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const hope = (who: string, store: string, day: string, kind = "hope") =>
  `insert into time_off_requests (company_id, membership_id, store_id, period_id, day, kind) values ('${CO_A}','${who}','${store}','${P}','${day}','${kind}')`;
const setStatus = (store: string, status: string) => `update store_period_status set status='${status}' where period_id='${P}' and store_id='${store}'`;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations").sort()) await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.exec(`
    insert into companies (id, code, name) values ('${CO_A}','co-a','A'), ('${CO_B}','co-b','B');
    insert into stores (id, company_id, name) values ('${S1}','${CO_A}','店1'), ('${S2}','${CO_A}','店2'), ('${SB}','${CO_B}','B店');
    insert into memberships (id, company_id, store_id, employee_code, name, level) values
      ('${U.office}','${CO_A}','${S1}','1','オフィス',4), ('${U.mgr1}','${CO_A}','${S1}','2','店長1',3),
      ('${U.shift1}','${CO_A}','${S1}','3','シフト担当1',2), ('${U.staff1}','${CO_A}','${S1}','4','スタッフ1',1),
      ('${U.staff1b}','${CO_A}','${S1}','5','スタッフ1b',1), ('${U.staff2}','${CO_A}','${S2}','6','スタッフ2',1),
      ('${U.mgr2}','${CO_A}','${S2}','7','店長2',3), ('${U.officeB}','${CO_B}','${SB}','1','B社オフィス',4),
      ('${U.staffB}','${CO_B}','${SB}','2','B社スタッフ',1);
  `);
});

describe("シフト期間の作成と進行", () => {
  it("期間を作れるのはオフィスだけ", async () => {
    for (const u of [U.mgr1, U.shift1, U.staff1])
      await as(u, async () => expect(await fails(`insert into shift_periods (id, company_id, start_date, end_date, label) values ('${P}','${CO_A}','2026-11-16','2026-12-15','11/16〜12/15')`)).toBe(true));
    await as(U.office, async () => {
      expect(await fails(`insert into shift_periods (id, company_id, start_date, end_date, label) values ('${P}','${CO_A}','2026-11-16','2026-12-15','11/16〜12/15')`)).toBe(false);
      for (const s of [S1, S2]) expect(await fails(`insert into store_period_status (period_id, store_id, company_id) values ('${P}','${s}','${CO_A}')`)).toBe(false);
      // 他社には作れない
      expect(await fails(`insert into shift_periods (id, company_id, start_date, end_date, label) values ('${PB}','${CO_B}','2026-10-16','2026-11-15','x')`)).toBe(true);
    });
  });

  it("他社の期間・進行状況は見えない", async () => {
    await db.exec(`insert into shift_periods (id, company_id, start_date, end_date, label) values ('${PB}','${CO_B}','2026-10-16','2026-11-15','B社');
      insert into store_period_status (period_id, store_id, company_id) values ('${PB}','${SB}','${CO_B}');`);
    await as(U.office, async () => {
      expect(await rows(`select 1 from shift_periods where id='${PB}'`)).toHaveLength(0);
      expect(await rows(`select 1 from store_period_status where period_id='${PB}'`)).toHaveLength(0);
    });
  });

  it("店長は自店の進行だけ動かせる（他店は不可）", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(setStatus(S1, "collecting"))).toBe(false);
      expect(await fails(setStatus(S2, "collecting"))).toBe(true);
    });
  });

  it("店長は後戻り・確認済みにできない。オフィスはできる。履歴が残る", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(setStatus(S1, "submitted"))).toBe(false);
      expect(await fails(setStatus(S1, "drafting"))).toBe(true);        // 後戻り不可
      expect(await fails(setStatus(S1, "acknowledged"))).toBe(true);    // 確認済みは不可
    });
    await as(U.office, async () => {
      expect(await fails(setStatus(S1, "acknowledged"))).toBe(false);
      expect(await fails(setStatus(S1, "collecting"))).toBe(false);     // 後戻りOK（やり直し）
      const logs = await rows(`select detail from audit_logs where action='period.status'`);
      expect(logs.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("希望休の提出（本人）", () => {
  it("受付前（準備中）は出せない", async () => {
    await as(U.staff2, async () => expect(await fails(hope(U.staff2, S2, "2026-11-20"))).toBe(true));
  });

  it("受付中なら出せる。1日1件。期間外の日付・他人の分・公休は出せない", async () => {
    await as(U.staff1, async () => {
      expect(await fails(hope(U.staff1, S1, "2026-11-18"))).toBe(false);
      expect(await fails(hope(U.staff1, S1, "2026-11-18"))).toBe(true);           // 重複
      expect(await fails(hope(U.staff1, S1, "2026-12-20"))).toBe(true);           // 期間外
      expect(await fails(hope(U.staff1, S1, "2026-11-10"))).toBe(true);           // 期間外
      expect(await fails(hope(U.staff1b, S1, "2026-11-19"))).toBe(true);          // 他人の分
      expect(await fails(hope(U.staff1, S1, "2026-11-19", "holiday"))).toBe(true);// 公休は管理者のみ
      expect(await fails(hope(U.staff1, S1, "2026-11-19", "paid"))).toBe(false);  // 有給希望はOK
      expect(await fails(hope(U.staff1, S2, "2026-11-20"))).toBe(true);           // 所属外の店舗
    });
  });

  it("締切日時を過ぎると出せない・消せない", async () => {
    await db.exec(`update store_period_status set request_close_at = now() - interval '1 minute' where period_id='${P}' and store_id='${S1}'`);
    await as(U.staff1, async () => {
      expect(await fails(hope(U.staff1, S1, "2026-11-22"))).toBe(true);
      expect(await fails(`delete from time_off_requests where membership_id='${U.staff1}'`)).toBe(true);
    });
    await db.exec(`update store_period_status set request_close_at = now() + interval '1 day' where period_id='${P}' and store_id='${S1}'`);
    await as(U.staff1, async () => expect(await fails(hope(U.staff1, S1, "2026-11-22"))).toBe(false));
  });

  it("締切（closed）後は編集できない", async () => {
    await as(U.office, async () => expect(await fails(setStatus(S1, "closed"))).toBe(false));
    await as(U.staff1, async () => {
      expect(await fails(hope(U.staff1, S1, "2026-11-25"))).toBe(true);
      expect(await fails(`delete from time_off_requests where membership_id='${U.staff1}' and day='2026-11-18'`)).toBe(true);
    });
  });
});

describe("希望休を見られる範囲・代理入力", () => {
  it("スタッフは自分の分だけ。同じ店の他人は見えない", async () => {
    await as(U.staff1b, async () => expect(await rows(`select 1 from time_off_requests`)).toHaveLength(0));
    await as(U.staff1, async () => expect((await rows(`select 1 from time_off_requests`)).length).toBeGreaterThan(0));
  });
  it("シフト担当(Lv2)は自店の全員分が見える。他店は見えない", async () => {
    await db.exec(`update store_period_status set status='collecting' where period_id='${P}' and store_id='${S2}'`);
    await as(U.staff2, async () => expect(await fails(hope(U.staff2, S2, "2026-11-20"))).toBe(false));
    await as(U.shift1, async () => {
      const r = await rows(`select membership_id from time_off_requests`);
      expect(r.every((x) => x.membership_id === U.staff1)).toBe(true);
      expect(r.length).toBeGreaterThan(0);
    });
  });
  it("店長は全店分が見える。他社は見えない", async () => {
    await as(U.mgr1, async () => expect((await rows(`select distinct store_id from time_off_requests`)).length).toBe(2));
    await as(U.officeB, async () => expect(await rows(`select 1 from time_off_requests`)).toHaveLength(0));
  });
  it("代理入力: 店長は自店のスタッフ分を締切後でも入力できる／他店は不可／Lv2・Lv1は不可", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(hope(U.staff1b, S1, "2026-11-30", "holiday"))).toBe(false);
      expect(await fails(hope(U.staff2, S2, "2026-11-30", "holiday"))).toBe(true);
    });
    await as(U.shift1, async () => expect(await fails(hope(U.staff1b, S1, "2026-12-01", "holiday"))).toBe(true));
    await as(U.office, async () => expect(await fails(hope(U.staff2, S2, "2026-11-29", "holiday"))).toBe(false));
  });
});

describe("表示専用アカウント（お店のiPad）", () => {
  const dispId = id(50);
  it("表示専用は、希望休を出せない。ほかの人（同じレベル1）は出せる", async () => {
    await admin0();
    await db.exec(`update store_period_status set status='collecting', request_close_at = null where period_id='${P}' and store_id='${S1}'`);
    await db.exec(`insert into memberships (id, company_id, store_id, employee_code, name, level, on_shift, display_only) values ('${dispId}','${CO_A}','${S1}','D1','店のiPad',1,false,true)`);
    await as(dispId, async () => expect(await fails(hope(dispId, S1, "2026-12-05"))).toBe(true));
    await as(U.staff1b, async () => expect(await fails(hope(U.staff1b, S1, "2026-12-05"))).toBe(false));
  });
  it("表示専用は、シフト・出勤簿に載せられない（レベル1・シフトに入らない）", async () => {
    await admin0();
    await expect(db.exec(`update memberships set on_shift = true where id='${dispId}'`)).rejects.toThrow();
    await expect(db.exec(`update memberships set level = 2 where id='${dispId}'`)).rejects.toThrow();
  });
  it("表示専用アカウントを作れるのは管理者だけ（店長・シフト担当は不可）", async () => {
    const ins = (code: string) => `insert into memberships (company_id, store_id, employee_code, name, level, on_shift, display_only) values ('${CO_A}','${S1}','${code}','端末',1,false,true)`;
    await as(U.mgr1, async () => expect(await fails(ins("D2"))).toBe(true));
    await as(U.shift1, async () => expect(await fails(ins("D3"))).toBe(true));
    await as(U.office, async () => expect(await fails(ins("D4"))).toBe(false));
  });
});
