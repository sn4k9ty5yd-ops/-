import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CO_A = "a0000000-0000-0000-0000-000000000001", CO_B = "b0000000-0000-0000-0000-000000000001";
const S1 = "a1000000-0000-0000-0000-000000000001", S2 = "a1000000-0000-0000-0000-000000000002", SB = "b1000000-0000-0000-0000-000000000001";
const U = { office: id(1), mgr1: id(2), mgr2: id(3), shift1: id(4), staff1: id(5), officeB: id(6) };
const P1 = "d0000000-0000-0000-0000-000000000001", P2 = "d0000000-0000-0000-0000-000000000002", P3 = "d0000000-0000-0000-0000-000000000003";

async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec(`select set_config('app.user_id','${user}',false); set role app_user;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const admin = () => db.exec("select set_config('app.user_id','',false)");
const fails = async (sql: string) => { try { return ((await db.query(sql)).affectedRows ?? 0) === 0; } catch { return true; } };
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const mv = (store: string, product: string, kind: string, delta: number) =>
  `insert into stock_movements (company_id, store_id, product_id, kind, delta) values ('${CO_A}','${store}','${product}','${kind}',${delta})`;
const qty = async (store: string, product: string) => Number((await rows(`select quantity from stock_levels where store_id='${store}' and product_id='${product}'`))[0]?.quantity ?? -1);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations").sort()) await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.exec(`
    insert into companies (id, code, name) values ('${CO_A}','co-a','A'), ('${CO_B}','co-b','B');
    insert into stores (id, company_id, name) values ('${S1}','${CO_A}','店1'), ('${S2}','${CO_A}','店2'), ('${SB}','${CO_B}','B店');
    insert into memberships (id, company_id, store_id, employee_code, name, level) values
      ('${U.office}','${CO_A}','${S1}','1','オフィス',4), ('${U.mgr1}','${CO_A}','${S1}','2','店長1',3), ('${U.mgr2}','${CO_A}','${S2}','3','店長2',3),
      ('${U.shift1}','${CO_A}','${S1}','4','シフト担当',2), ('${U.staff1}','${CO_A}','${S1}','5','スタッフ1',1), ('${U.officeB}','${CO_B}','${SB}','1','B社オフィス',4);
    insert into products (id, company_id, kind, name, cost_price) values
      ('${P1}','${CO_A}','retail','シャンプー',1200), ('${P2}','${CO_A}','supply','カラー剤',600), ('${P3}','${CO_A}','supply','店2専用',500);
    insert into product_stores (product_id, store_id, company_id) values
      ('${P1}','${S1}','${CO_A}'), ('${P1}','${S2}','${CO_A}'), ('${P2}','${S1}','${CO_A}'), ('${P2}','${S2}','${CO_A}'), ('${P3}','${S2}','${CO_A}');
  `);
});

describe("入庫・出庫・在庫の数量", () => {
  it("入庫で増え、出庫で減り、数え直しで合わせられる。記録に「そのあとの数」と名前が残る", async () => {
    await as(U.shift1, async () => {
      expect(await fails(mv(S1, P2, "in", 10))).toBe(false);
      expect(await fails(mv(S1, P2, "out", -3))).toBe(false);
      expect(await fails(mv(S1, P2, "recount", -2))).toBe(false);
    });
    expect(await qty(S1, P2)).toBe(5);
    await as(U.mgr1, async () => {
      const r = await rows(`select kind, delta, quantity_after, name from stock_movements order by created_at, id`);
      expect(r.map((x) => [x.kind, x.delta, x.quantity_after])).toEqual([["in", 10, 10], ["out", -3, 7], ["recount", -2, 5]]);
      expect(r[0].name).toBe("カラー剤");
    });
  });
  it("向きがおかしい記録・0・在庫より多い出庫は不可（在庫はマイナスにならない）", async () => {
    await as(U.shift1, async () => {
      expect(await fails(mv(S1, P2, "in", -1))).toBe(true);
      expect(await fails(mv(S1, P2, "out", 1))).toBe(true);
      expect(await fails(mv(S1, P2, "in", 0))).toBe(true);
      expect(await fails(mv(S1, P2, "out", -6))).toBe(true);     // いま5
      expect(await fails(mv(S1, P2, "out", -5))).toBe(false);    // ちょうどゼロはOK
    });
    expect(await qty(S1, P2)).toBe(0);
    await as(U.shift1, async () => expect(await fails(mv(S1, P2, "in", 4))).toBe(false));
  });
  it("そのお店で使わない商品は記録できない", async () => {
    await as(U.shift1, async () => expect(await fails(mv(S1, P3, "in", 1))).toBe(true));
    await as(U.mgr2, async () => expect(await fails(mv(S2, P3, "in", 1))).toBe(false));
  });
  it("履歴は直せない・消せない。在庫の数量を直接は書き換えられない（オフィスでも）", async () => {
    await as(U.office, async () => {
      expect(await fails(`update stock_movements set delta = 99`)).toBe(true);
      expect(await fails(`delete from stock_movements`)).toBe(true);
      expect(await fails(`update stock_levels set quantity = 999`)).toBe(true);
      expect(await fails(`insert into stock_levels (store_id, product_id, company_id, quantity) values ('${S1}','${P1}','${CO_A}', 50)`)).toBe(true);
    });
  });
});

describe("見られる人・記録できる人", () => {
  it("スタッフは見えない・記録できない。他店の店長は見るだけ。他社は何も見えない", async () => {
    await as(U.staff1, async () => { expect(await rows("select 1 from stock_levels")).toHaveLength(0); expect(await fails(mv(S1, P1, "in", 1))).toBe(true); });
    await as(U.mgr1, async () => {
      expect((await rows("select distinct store_id from stock_levels")).length).toBe(2);
      expect(await fails(mv(S2, P1, "in", 1))).toBe(true);
    });
    await as(U.shift1, async () => { expect(await rows(`select 1 from stock_levels where store_id='${S2}'`)).toHaveLength(0); expect(await fails(mv(S2, P1, "in", 1))).toBe(true); });
    await as(U.office, async () => expect(await fails(mv(S2, P1, "in", 5))).toBe(false));
    await as(U.officeB, async () => { expect(await rows("select 1 from stock_levels")).toHaveLength(0); expect(await rows("select 1 from stock_movements")).toHaveLength(0); });
  });
});

describe("お店ごとの「使う機能」の選択", () => {
  // 設定の行が無ければ作ってから、値を更新する（行を作る権限も更新する権限も、店長(自店)とオフィスだけ）
  const settings = async (store: string, set: string) => {
    try {
      await db.query(`insert into store_stock_settings (store_id, company_id) values ('${store}','${CO_A}') on conflict (store_id) do nothing`);
      return ((await db.query(`update store_stock_settings set ${set} where store_id='${store}'`)).affectedRows ?? 0) === 0;
    } catch { return true; }
  };
  it("変えられるのは店長（自店）とオフィス。シフト担当は不可", async () => {
    await as(U.shift1, async () => expect(await settings(S1, "use_movements = false")).toBe(true));
    await as(U.mgr1, async () => { expect(await settings(S2, "use_movements = false")).toBe(true); });
  });
  it("入庫・出庫を使わない設定にすると、入庫・出庫はできないが数え直しはできる", async () => {
    await as(U.mgr1, async () => expect(await settings(S1, "use_movements = false")).toBe(false));
    await as(U.shift1, async () => {
      expect(await fails(mv(S1, P1, "in", 3))).toBe(true);
      expect(await fails(mv(S1, P1, "out", -1))).toBe(true);
      expect(await fails(mv(S1, P1, "recount", 3))).toBe(false);
    });
    expect(await qty(S1, P1)).toBe(3);
  });
  it("数え直しを使わない設定にすると、数え直しはできない", async () => {
    await as(U.mgr1, async () => expect(await settings(S1, "use_movements = true, use_recount = false")).toBe(false));
    await as(U.shift1, async () => { expect(await fails(mv(S1, P1, "recount", 1))).toBe(true); expect(await fails(mv(S1, P1, "in", 1))).toBe(false); });
  });
  it("業務(材料)を管理しない設定にすると、業務の商品は記録できない。店販は続けられる", async () => {
    await as(U.mgr1, async () => expect(await settings(S1, "use_recount = true, track_supply = false")).toBe(false));
    await as(U.shift1, async () => { expect(await fails(mv(S1, P2, "in", 1))).toBe(true); expect(await fails(mv(S1, P1, "in", 1))).toBe(false); });
    await as(U.mgr1, async () => expect(await settings(S1, "track_supply = true")).toBe(false));
  });
  it("他のお店の設定は、そのお店に影響しない（店2は初期値のまま全部使える）", async () => {
    await as(U.mgr2, async () => expect(await fails(mv(S2, P2, "in", 1))).toBe(false));
  });
});

describe("発注点・補充の目標", () => {
  it("決められるのは店長（自店）とオフィス。シフト担当は不可。見るのはシフト担当も可", async () => {
    await as(U.mgr1, async () => expect(await fails(`update stock_levels set min_quantity = 2, target_quantity = 10 where store_id='${S1}' and product_id='${P2}'`)).toBe(false));
    await as(U.shift1, async () => {
      expect(await fails(`update stock_levels set min_quantity = 9 where store_id='${S1}' and product_id='${P2}'`)).toBe(true);
      expect(Number((await rows(`select min_quantity from stock_levels where store_id='${S1}' and product_id='${P2}'`))[0].min_quantity)).toBe(2);
    });
    await as(U.mgr1, async () => expect(await fails(`update stock_levels set min_quantity = -1 where store_id='${S1}' and product_id='${P2}'`)).toBe(true));
    await as(U.mgr1, async () => expect(await fails(`update stock_levels set min_quantity = 1 where store_id='${S2}'`)).toBe(true));
  });
});
