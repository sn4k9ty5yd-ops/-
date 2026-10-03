import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { pgliteDatabase } from "../lib/db/adapters";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};
const pr: Record<string, string> = {};
const item = async (u: string, s: string, name: string) => (await svc.listStock(db, u, s)).items.find((i) => i.name === name)!;

beforeAll(async () => {
  db = pgliteDatabase(new PGlite());
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st.s1); await mk("mgr1", "2", 3, st.s1); await mk("shift1", "3", 2, st.s1); await mk("staff", "4", 1, st.s1); await mk("mgr2", "5", 3, st.s2);
  await svc.createProducts(db, id.office, "supply", [{ maker: "ﾙﾍﾞﾙ", name: "ｶﾗｰ剤", spec: "80g", costPrice: 600 }, { maker: "ﾙﾍﾞﾙ", name: "ﾊﾟｰﾏ剤", spec: "1L", costPrice: 900 }], [st.s1, st.s2]);
  await svc.createProducts(db, id.office, "retail", [{ maker: "ﾐﾙﾎﾞﾝ", name: "ｼｬﾝﾌﾟｰ", spec: "500ml", costPrice: 1200 }], [st.s1]);
  for (const p of [...(await svc.listProducts(db, id.office, "supply")), ...(await svc.listProducts(db, id.office, "retail"))]) pr[p.name] = p.id;
});

describe("在庫一覧・入庫・出庫", () => {
  it("そのお店で使う商品が、在庫0で並ぶ（店販・業務の両方）", async () => {
    const { items } = await svc.listStock(db, id.shift1, st.s1);
    expect(items.map((i) => [i.name, i.quantity]).sort()).toEqual([["ｶﾗｰ剤", 0], ["ｼｬﾝﾌﾟｰ", 0], ["ﾊﾟｰﾏ剤", 0]].sort());
    expect((await svc.listStock(db, id.mgr2, st.s2)).items.map((i) => i.name).sort()).toEqual(["ｶﾗｰ剤", "ﾊﾟｰﾏ剤"].sort());   // 店2は店販を使わない商品構成
  });
  it("入庫・出庫で数が変わる。在庫より多い出庫は、やさしいメッセージで断る", async () => {
    await svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 10, note: "10月の仕入れ" }]);
    await svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "out", qty: 3 }]);
    expect((await item(id.shift1, st.s1, "ｶﾗｰ剤")).quantity).toBe(7);
    await expect(svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "out", qty: 8 }])).rejects.toThrow("在庫（7個）より多くは出せません");
    expect((await item(id.shift1, st.s1, "ｶﾗｰ剤")).quantity).toBe(7);
  });
  it("数は1以上の整数だけ。1件でも失敗したら全部取り消される", async () => {
    await expect(svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 0 }])).rejects.toThrow("整数");
    await expect(svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 1.5 }])).rejects.toThrow("整数");
    await expect(svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 5 }, { productId: pr["ﾊﾟｰﾏ剤"], kind: "out", qty: 1 }])).rejects.toThrow("在庫（0個）");
    expect((await item(id.shift1, st.s1, "ｶﾗｰ剤")).quantity).toBe(7);
  });
  it("履歴に、いつ・だれが・何個・メモ・そのあとの数が残る", async () => {
    const h = await svc.listMovements(db, id.shift1, st.s1, pr["ｶﾗｰ剤"]);
    expect(h.map((x) => [x.kind, x.delta, x.after, x.by, x.note])).toEqual([["out", -3, 7, "shift1", null], ["in", 10, 10, "shift1", "10月の仕入れ"]]);
    expect(h[0].at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it("権限: スタッフは不可・他店は不可（店長でも）・店長は自店OK", async () => {
    await expect(svc.recordMovements(db, id.staff, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 1 }])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.recordMovements(db, id.mgr1, st.s2, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 1 }])).rejects.toThrow(svc.ForbiddenError);
    await svc.recordMovements(db, id.mgr1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 1 }]);
    expect((await svc.listStock(db, id.staff, st.s1)).items).toEqual([]);
  });
  it("そのお店で使わない商品は記録できない（店2に店販シャンプーは無い）", async () => {
    await expect(svc.recordMovements(db, id.mgr2, st.s2, [{ productId: pr["ｼｬﾝﾌﾟｰ"], kind: "in", qty: 1 }])).rejects.toThrow(svc.ForbiddenError);
  });
});

describe("数え直し・棚卸しからの反映", () => {
  it("数えた数を入れると、差が記録されて在庫が合う。同じ数なら何も記録しない", async () => {
    expect(await svc.recountStock(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], counted: 5 }, { productId: pr["ﾊﾟｰﾏ剤"], counted: 0 }])).toBe(1);
    expect((await item(id.shift1, st.s1, "ｶﾗｰ剤")).quantity).toBe(5);
    const h = (await svc.listMovements(db, id.shift1, st.s1, pr["ｶﾗｰ剤"]))[0];
    expect([h.kind, h.delta, h.after, h.note]).toEqual(["recount", -3, 5, "数え直し"]);   // 8 → 5
    await expect(svc.recountStock(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], counted: -1 }])).rejects.toThrow("整数");
  });
  it("棚卸しの数量を在庫に反映できる（提出後、店長・オフィス）", async () => {
    const sid = await svc.startStocktake(db, id.mgr1, st.s1, "supply", "2026-10-31");
    const d = (await svc.getStocktake(db, id.mgr1, sid))!;
    await svc.saveQuantities(db, id.mgr1, sid, d.items.map((i) => ({ lineId: i.id, quantity: i.name === "ｶﾗｰ剤" ? 12 : 2 })));
    await expect(svc.applyStocktakeToStock(db, id.mgr1, sid)).rejects.toThrow("提出してから");
    await svc.setStocktakeStatus(db, id.mgr1, sid, "submitted");
    await expect(svc.applyStocktakeToStock(db, id.shift1, sid)).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.applyStocktakeToStock(db, id.mgr1, sid)).toBe(2);
    expect([(await item(id.mgr1, st.s1, "ｶﾗｰ剤")).quantity, (await item(id.mgr1, st.s1, "ﾊﾟｰﾏ剤")).quantity]).toEqual([12, 2]);
    expect(await svc.applyStocktakeToStock(db, id.mgr1, sid)).toBe(0);   // 二度目は差がないので何も増えない
  });
});

describe("発注の目安", () => {
  it("発注点以下で「少ない」。補充の目標があれば、足りない数の目安が出る", async () => {
    await svc.setStockLimits(db, id.mgr1, st.s1, pr["ｶﾗｰ剤"], 5, 20);
    expect(await item(id.mgr1, st.s1, "ｶﾗｰ剤")).toMatchObject({ quantity: 12, low: false, suggested: null });
    await svc.recordMovements(db, id.mgr1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "out", qty: 8 }]);
    expect(await item(id.mgr1, st.s1, "ｶﾗｰ剤")).toMatchObject({ quantity: 4, low: true, suggested: 16 });
    await svc.setStockLimits(db, id.mgr1, st.s1, pr["ﾊﾟｰﾏ剤"], 3, null);
    expect(await item(id.mgr1, st.s1, "ﾊﾟｰﾏ剤")).toMatchObject({ low: true, suggested: null });
  });
  it("おかしな値は断る。決められるのは店長(自店)とオフィス", async () => {
    await expect(svc.setStockLimits(db, id.mgr1, st.s1, pr["ｶﾗｰ剤"], 10, 5)).rejects.toThrow("目標は、発注点以上");
    await expect(svc.setStockLimits(db, id.mgr1, st.s1, pr["ｶﾗｰ剤"], -1, null)).rejects.toThrow("整数");
    await expect(svc.setStockLimits(db, id.shift1, st.s1, pr["ｶﾗｰ剤"], 1, 2)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStockLimits(db, id.mgr2, st.s1, pr["ｶﾗｰ剤"], 1, 2)).rejects.toThrow(svc.ForbiddenError);
  });
});

describe("お店ごとの「使う機能」の選択", () => {
  it("初期値は全部使う。店長は自店、オフィスは全店の設定を変えられる。シフト担当・他店の店長は不可", async () => {
    expect(await svc.getStockSettings(db, id.mgr1, st.s1)).toEqual(svc.DEFAULT_STOCK_SETTINGS);
    await expect(svc.setStockSettings(db, id.shift1, st.s1, { ...svc.DEFAULT_STOCK_SETTINGS, useMovements: false })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStockSettings(db, id.mgr2, st.s1, { ...svc.DEFAULT_STOCK_SETTINGS, useMovements: false })).rejects.toThrow(svc.ForbiddenError);
    await svc.setStockSettings(db, id.mgr1, st.s1, { ...svc.DEFAULT_STOCK_SETTINGS, useMovements: false });
    expect((await svc.getStockSettings(db, id.shift1, st.s1)).useMovements).toBe(false);
  });
  it("入庫・出庫を使わない店では、入庫・出庫は断られ、数え直しは使える", async () => {
    await expect(svc.recordMovements(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 1 }])).rejects.toThrow("入庫・出庫」を使わない");
    expect(await svc.recountStock(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], counted: 9 }])).toBe(1);
  });
  it("数え直しを使わない店では、数え直しも棚卸しの反映も断られる", async () => {
    await svc.setStockSettings(db, id.office, st.s1, { ...svc.DEFAULT_STOCK_SETTINGS, useMovements: true, useRecount: false });
    await expect(svc.recountStock(db, id.shift1, st.s1, [{ productId: pr["ｶﾗｰ剤"], counted: 1 }])).rejects.toThrow("数え直し」を使わない");
  });
  it("発注の目安を使わない店では「少ない」表示が出ない", async () => {
    await svc.setStockSettings(db, id.office, st.s1, { ...svc.DEFAULT_STOCK_SETTINGS, useReorder: false });
    expect((await svc.listStock(db, id.mgr1, st.s1)).items.some((i) => i.low)).toBe(false);
    await svc.setStockSettings(db, id.office, st.s1, svc.DEFAULT_STOCK_SETTINGS);
  });
  it("業務を管理しない店では、一覧に業務が出ず、記録もできない。店販は使える", async () => {
    await svc.setStockSettings(db, id.mgr1, st.s1, { ...svc.DEFAULT_STOCK_SETTINGS, trackSupply: false });
    expect((await svc.listStock(db, id.mgr1, st.s1)).items.map((i) => i.kind)).toEqual(["retail"]);
    await expect(svc.recordMovements(db, id.mgr1, st.s1, [{ productId: pr["ｶﾗｰ剤"], kind: "in", qty: 1 }])).rejects.toThrow(svc.ForbiddenError);
    await svc.recordMovements(db, id.mgr1, st.s1, [{ productId: pr["ｼｬﾝﾌﾟｰ"], kind: "in", qty: 2 }]);
  });
  it("お店ごとに独立している（店2は初期値のまま）", async () => {
    expect(await svc.getStockSettings(db, id.mgr2, st.s2)).toEqual(svc.DEFAULT_STOCK_SETTINGS);
  });
});
