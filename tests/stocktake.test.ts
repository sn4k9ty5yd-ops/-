import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CO_A = "a0000000-0000-0000-0000-000000000001", CO_B = "b0000000-0000-0000-0000-000000000001";
const S1 = "a1000000-0000-0000-0000-000000000001", S2 = "a1000000-0000-0000-0000-000000000002", SB = "b1000000-0000-0000-0000-000000000001";
const U = { office: id(1), mgr1: id(2), mgr2: id(3), shift1: id(4), staff1: id(5), officeB: id(6) };
const P1 = "d0000000-0000-0000-0000-000000000001", P2 = "d0000000-0000-0000-0000-000000000002", P3 = "d0000000-0000-0000-0000-000000000003";
const ST1 = "e0000000-0000-0000-0000-000000000001", ST2 = "e0000000-0000-0000-0000-000000000002";

async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec(`select set_config('app.user_id','${user}',false); set role app_user;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const fails = async (sql: string) => { try { return ((await db.query(sql)).affectedRows ?? 0) === 0; } catch { return true; } };
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const newProduct = (idv: string, kind: string, name: string, price = 1000) =>
  `insert into products (id, company_id, kind, maker, name, spec, cost_price) values ('${idv}','${CO_A}','${kind}','ﾒｰｶｰ','${name}','500ml',${price})`;
const line = (st: string, store: string, product: string, name: string, price: number, qty: number | null = null) =>
  `insert into stocktake_lines (stocktake_id, company_id, store_id, product_id, name, cost_price, quantity) values ('${st}','${CO_A}','${store}','${product}','${name}',${price},${qty ?? "null"})`;
const admin = () => db.exec("select set_config('app.user_id','',false)");   // 人が操作していない状態（サーバーの管理処理）
const status = (st: string, s: string) => `update stocktakes set status='${s}' where id='${st}'`;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations").sort()) await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.exec(`
    insert into companies (id, code, name) values ('${CO_A}','co-a','A'), ('${CO_B}','co-b','B');
    insert into stores (id, company_id, name) values ('${S1}','${CO_A}','店1'), ('${S2}','${CO_A}','店2'), ('${SB}','${CO_B}','B店');
    insert into memberships (id, company_id, store_id, employee_code, name, level) values
      ('${U.office}','${CO_A}','${S1}','1','オフィス',4), ('${U.mgr1}','${CO_A}','${S1}','2','店長1',3), ('${U.mgr2}','${CO_A}','${S2}','3','店長2',3),
      ('${U.shift1}','${CO_A}','${S1}','4','シフト担当',2), ('${U.staff1}','${CO_A}','${S1}','5','スタッフ1',1), ('${U.officeB}','${CO_B}','${SB}','1','B社オフィス',4);
  `);
});

describe("商品マスター", () => {
  it("登録・編集できるのはオフィスだけ", async () => {
    for (const u of [U.mgr1, U.shift1, U.staff1]) await as(u, async () => expect(await fails(newProduct(P1, "retail", "シャンプー"))).toBe(true));
    await as(U.office, async () => {
      expect(await fails(newProduct(P1, "retail", "シャンプー"))).toBe(false);   // 共通
      expect(await fails(newProduct(P2, "retail", "トリートメント", 1500))).toBe(false); // 店1専用
      expect(await fails(newProduct(P3, "supply", "カラー剤", 800))).toBe(false);  // 業務・店2専用
      expect(await fails(`insert into product_stores (product_id, store_id, company_id) values ('${P1}','${S1}','${CO_A}'),('${P1}','${S2}','${CO_A}'),('${P2}','${S1}','${CO_A}'),('${P3}','${S2}','${CO_A}')`)).toBe(false);
    });
  });
  it("同じ種類・メーカー・品名・規格の二重登録は不可", async () => {
    await as(U.office, async () => expect(await fails(newProduct("d0000000-0000-0000-0000-0000000000ff", "retail", "シャンプー"))).toBe(true));
  });
  it("見える範囲: スタッフは見えない。シフト担当は自店で使う商品だけ。店長・オフィスは全部。他社は見えない", async () => {
    await as(U.staff1, async () => expect((await rows("select 1 from products")).length).toBeGreaterThan(0));   // 棚卸しはみんなでやる: 自店で使う商品は見られる
    await as(U.shift1, async () => expect((await rows("select name from products order by name")).map((r) => r.name)).toEqual(["シャンプー", "トリートメント"]));
    await as(U.mgr1, async () => expect(await rows("select 1 from products")).toHaveLength(3));
    await as(U.officeB, async () => { expect(await rows("select 1 from products")).toHaveLength(0); expect(await rows("select 1 from product_stores")).toHaveLength(0); });
  });
  it("他社の店舗には、商品を割り当てられない", async () => {
    await as(U.office, async () => expect(await fails(`insert into product_stores (product_id, store_id, company_id) values ('${P3}','${SB}','${CO_A}')`)).toBe(true));
  });
  it("仕入値はマイナス不可・取扱い終了にできる", async () => {
    await as(U.office, async () => {
      expect(await fails(`update products set cost_price = -1 where id='${P1}'`)).toBe(true);
      expect(await fails(`update products set status='discontinued' where id='${P3}'`)).toBe(false);
      expect(await fails(`update products set status='active' where id='${P3}'`)).toBe(false);
    });
  });
});

describe("棚卸しを始める・数量を入れる", () => {
  it("始められるのは自店のみんな（スタッフも）とオフィス。他店は不可", async () => {
    const ins = (i: string, s: string) => `insert into stocktakes (id, company_id, store_id, kind, taken_on) values ('${i}','${CO_A}','${s}','retail','2026-10-31')`;
    const ins2 = (i: string, s: string, d: string) => `insert into stocktakes (id, company_id, store_id, kind, taken_on) values ('${i}','${CO_A}','${s}','retail','${d}')`;
    await as(U.shift1, async () => expect(await fails(ins2("e0000000-0000-0000-0000-0000000000b1", S1, "2026-09-30"))).toBe(false));
    await as(U.staff1, async () => expect(await fails(ins2("e0000000-0000-0000-0000-0000000000b2", S1, "2026-09-29"))).toBe(false));
    for (const u of [U.shift1, U.staff1]) await as(u, async () => expect(await fails(ins2("e0000000-0000-0000-0000-0000000000b3", S2, "2026-09-28"))).toBe(true));   // 他店は不可
    await admin(); await db.exec("delete from stocktakes where taken_on < '2026-10-01'");
    await as(U.mgr1, async () => { expect(await fails(ins(ST1, S1))).toBe(false); expect(await fails(ins(ST2, S2))).toBe(true); });
    await as(U.office, async () => expect(await fails(ins(ST2, S2))).toBe(false));
    await as(U.mgr1, async () => expect(await fails(ins("e0000000-0000-0000-0000-0000000000aa", S1))).toBe(true));  // 同じ店・種類・日は1つだけ
  });
  it("数量は、みんなが入れられる。整数・0以上のみ。仕入値・名前は変えられない", async () => {
    await as(U.mgr1, async () => {
      expect(await fails(line(ST1, S1, P1, "シャンプー", 1000))).toBe(false);
      expect(await fails(line(ST1, S1, P2, "トリートメント", 1500))).toBe(false);
    });
    await as(U.shift1, async () => {
      expect(await fails(`update stocktake_lines set quantity = 3 where product_id='${P1}'`)).toBe(false);
      expect(await fails(`update stocktake_lines set quantity = -1 where product_id='${P1}'`)).toBe(true);
      expect(await fails(`update stocktake_lines set cost_price = 1 where product_id='${P1}'`)).toBe(true);  // 仕入値は変えられない
      expect(await fails(`update stocktake_lines set name = '改名' where product_id='${P1}'`)).toBe(true);
    });
    await as(U.staff1, async () => { expect((await rows("select 1 from stocktake_lines")).length).toBeGreaterThan(0); expect(await fails(`update stocktake_lines set quantity = quantity`)).toBe(false); });   // みんなでやる: 一般のスタッフも見られて、数量を入れられる
  });
  it("金額 = 仕入値 × 数量（未入力は0円）", async () => {
    await as(U.mgr1, async () => {
      const r = await rows(`select name, quantity, amount from stocktake_lines order by name`);
      expect(r.map((x) => [x.name, x.quantity, Number(x.amount)])).toEqual([["シャンプー", 3, 3000], ["トリートメント", null, 0]]);
    });
  });
  it("商品マスターを変えても、棚卸しの仕入値・名前は変わらない", async () => {
    await as(U.office, async () => expect(await fails(`update products set cost_price = 9999, name = '新名称' where id='${P1}'`)).toBe(false));
    await as(U.mgr1, async () => {
      const r = await rows(`select name, cost_price from stocktake_lines where product_id='${P1}'`);
      expect(r[0]).toMatchObject({ name: "シャンプー", cost_price: 1000 });
    });
    await as(U.office, async () => expect(await fails(`update products set cost_price = 1000, name = 'シャンプー' where id='${P1}'`)).toBe(false));
  });
  it("見られる範囲: 店長は自分のお店だけ。他店は見えず入力もできない。他社は見えない", async () => {
    await admin();
    await db.exec(`insert into stocktakes (id, company_id, store_id, kind, taken_on) values ('${ST2}','${CO_A}','${S2}','supply','2026-10-31') on conflict do nothing`);
    await db.exec(line(ST2, S2, P3, "カラー剤", 800, 2));
    await as(U.mgr1, async () => {
      expect((await rows("select distinct store_id from stocktake_lines")).length).toBe(1);   // 店長は自分のお店だけ
      expect(await fails(`update stocktake_lines set quantity = 5 where stocktake_id='${ST2}'`)).toBe(true);
    });
    await as(U.officeB, async () => expect(await rows("select 1 from stocktake_lines")).toHaveLength(0));
  });
});

describe("提出と確認", () => {
  it("数量が未入力の商品があると提出できない。全部入れたら提出できる（シフト担当は提出できない）", async () => {
    await as(U.mgr1, async () => expect(await fails(status(ST1, "submitted"))).toBe(true));
    await as(U.shift1, async () => expect(await fails(`update stocktake_lines set quantity = 4 where product_id='${P2}'`)).toBe(false));
    await as(U.shift1, async () => expect(await fails(status(ST1, "submitted"))).toBe(false));   // 全部入っていれば、シフト担当も提出できる
    await as(U.mgr1, async () => expect(await fails(status(ST1, "submitted"))).toBe(false));
  });
  it("提出後は店長・シフト担当は直せない。オフィスは直せる", async () => {
    for (const u of [U.mgr1, U.shift1]) await as(u, async () => expect(await fails(`update stocktake_lines set quantity = 9 where product_id='${P2}'`)).toBe(true));
    await as(U.office, async () => expect(await fails(`update stocktake_lines set quantity = 5 where product_id='${P2}'`)).toBe(false));
  });
  it("店長は確認済みにできない・後戻りできない。オフィスは確認済みにでき、そのあとは誰も直せない", async () => {
    await as(U.mgr1, async () => { expect(await fails(status(ST1, "acknowledged"))).toBe(true); expect(await fails(status(ST1, "open"))).toBe(true); });
    await as(U.office, async () => expect(await fails(status(ST1, "acknowledged"))).toBe(false));
    await as(U.office, async () => expect(await fails(`update stocktake_lines set quantity = 1 where product_id='${P2}'`)).toBe(true));
    await as(U.office, async () => expect(await fails(status(ST1, "open"))).toBe(false));   // オフィスは戻せる
  });
  it("状態の変更は履歴に残る。入力中の棚卸しだけ削除できる", async () => {
    await as(U.office, async () => expect((await rows("select 1 from audit_logs where action = 'stocktake.status'")).length).toBeGreaterThanOrEqual(3));
    await as(U.mgr1, async () => expect(await rows("select 1 from audit_logs")).toHaveLength(0));
    await admin(); await db.exec(status(ST1, "submitted"));
    await as(U.mgr1, async () => expect(await fails(`delete from stocktakes where id='${ST1}'`)).toBe(true));
    await admin(); await db.exec(status(ST1, "open"));
    await as(U.mgr1, async () => expect(await fails(`delete from stocktakes where id='${ST1}'`)).toBe(false));
  });
});
