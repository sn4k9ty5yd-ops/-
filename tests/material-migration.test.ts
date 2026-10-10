import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";

describe("材料費の移行(0077): 主なディーラー・小物・髪ドラはFITの中", () => {
  it("髪ドラの発注は FIT／髪ドラ になり、業者の並びは主なディーラーが先頭。全業者に小物が入る", async () => {
    const db = await newDb(); await migrate(db);
    const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-m','M社') returning id")).rows[0].id;
    const st = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'天神') returning id", [co])).rows[0].id;
    const u = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'1','A',1) returning id", [co, st])).rows[0].id;
    await db.query("insert into material_dealers (company_id, store_id, name, sort_order) values ($1,$2,'髪ドラ',1),($1,$2,'ダリア',2),($1,$2,'その他商事',3)", [co, st]);
    const hd = (await db.query<{ id: string }>("select id from material_dealers where name = '髪ドラ'")).rows[0].id;
    await db.query("insert into material_categories (company_id, store_id, dealer_id, name, sort_order) values ($1,$2,$3,'カラー',1)", [co, st, hd]);
    await db.query("insert into material_orders (company_id, store_id, ordered_on, supplier, amount, created_by) values ($1,$2,'2026-10-01','髪ドラ',1000,$3),($1,$2,'2026-10-02','ダリア',2000,$3)", [co, st, u]);

    await db.query(readFileSync("db/migrations/0077_material_main_dealers_misc.sql", "utf8"));

    const dealers = (await db.query<{ name: string }>("select name from material_dealers where store_id = $1 order by sort_order, name", [st])).rows.map((r) => r.name);
    expect(dealers).toEqual(["ダリア", "コスモ", "キクヤ", "FIT", "藤井企画", "その他商事"]);   // 髪ドラは消え、主な5つが先頭
    const orders = (await db.query<{ supplier: string; category: string }>("select supplier, category from material_orders order by ordered_on")).rows;
    expect(orders).toEqual([{ supplier: "FIT", category: "髪ドラ" }, { supplier: "ダリア", category: "" }]);
    const fit = (await db.query<{ n: string }>("select c.name as n from material_categories c join material_dealers d on d.id = c.dealer_id where d.name = 'FIT' order by c.sort_order")).rows.map((r) => r.n);
    expect(fit).toEqual(["カラー", "ストレート", "パーマ", "小物", "その他", "髪ドラ"]);
    const dariaCats = (await db.query<{ n: string }>("select c.name as n from material_categories c join material_dealers d on d.id = c.dealer_id where d.name = 'ダリア' order by c.sort_order")).rows.map((r) => r.n);
    expect(dariaCats).toEqual(["カラー", "ストレート", "パーマ", "小物", "その他"]);
  });
});
