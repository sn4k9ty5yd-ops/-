import { describe, expect, it } from "vitest";
import { itemsByMonthTable, monthItems } from "../lib/material-items";
import type { MaterialOrder } from "../lib/service";

const o = (id: string, day: string, lines: { name: string; qty: number; amount: number }[], item = "", amount = 0, deleted = false): MaterialOrder =>
  ({ id, storeId: "s", orderedOn: day, category: "", supplier: "A社", item, kind: "supply", amount, note: "", lines, taxMode: "ex", entered: null, by: null, at: "", deleted, edited: false });

describe("発注した商品の一覧", () => {
  const orders = [
    o("1", "2026-10-03", [{ name: "シャンプー", qty: 3, amount: 3000 }, { name: "カラー剤", qty: 10, amount: 8000 }]),
    o("2", "2026-10-20", [{ name: "シャンプー", qty: 2, amount: 2000 }]),
    o("3", "2026-09-05", [{ name: "シャンプー", qty: 4, amount: 4000 }]),
    o("4", "2026-10-25", [], "ペーパー類", 1500),
    o("5", "2026-10-26", [{ name: "取り消した品", qty: 9, amount: 9 }], "", 0, true),
  ];
  it("その月の商品ごとの個数と金額（個数の多い順・取り消した分は入れない）", () => {
    const r = monthItems(orders, "2026-10");
    expect(r.map((x) => [x.name, x.qty, x.amount])).toEqual([["カラー剤", 10, 8000], ["シャンプー", 5, 5000], ["ペーパー類", 1, 1500]]);
  });
  it("数か月ぶんの表: 商品×月の個数。多く発注している商品が上", () => {
    const t = itemsByMonthTable(orders, ["2026-09", "2026-10"]);
    expect(t.rows[0]).toMatchObject({ name: "カラー剤", qty: 10 });
    expect(t.rows.find((x) => x.name === "シャンプー")).toMatchObject({ byMonth: [4, 5], qty: 9 });
  });
});
