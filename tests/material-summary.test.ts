import { describe, expect, it } from "vitest";
import { summarize } from "../lib/material-summary";

describe("材料費の統括", () => {
  const orders = [
    { id: "1", storeId: "a", orderedOn: "2026-09-05", supplier: "甲", item: "", kind: "supply" as const, amount: 10000 },
    { id: "2", storeId: "b", orderedOn: "2026-10-02", supplier: "甲", item: "シャンプー", kind: "retail" as const, amount: 5000 },
    { id: "3", storeId: "a", orderedOn: "2026-10-09", supplier: "乙", item: "", kind: "supply" as const, amount: 15000 },
  ];
  const lines = [{ orderId: "1", name: "カラー剤", qty: 10, amount: 8000 }, { orderId: "1", name: "シャンプー", qty: 2, amount: 2000 }, { orderId: "3", name: "カラー剤", qty: 20, amount: 15000 }];
  const s = summarize(orders, lines, (id) => (id === "a" ? "ATENA" : "六本松"));
  it("合計・月ごと・前の月との増減", () => {
    expect(s.total).toBe(30000);
    expect(s.months).toEqual([{ month: "2026-09", total: 10000, count: 1, change: null }, { month: "2026-10", total: 20000, count: 2, change: 100 }]);
    expect(s.avgPerMonth).toBe(15000);
  });
  it("お店・種類・発注先の割合", () => {
    expect(s.byStore.map((x) => [x.label, x.pct])).toEqual([["ATENA", 83.3], ["六本松", 16.7]]);
    expect(s.byKind.find((x) => x.key === "supply")?.pct).toBe(83.3);
    expect(s.bySupplier.map((x) => x.amount)).toEqual([15000, 15000]);
  });
  it("何を発注したか: 明細があれば明細、なければ内容", () => {
    expect(s.byItem[0]).toMatchObject({ name: "カラー剤", qty: 30, amount: 23000 });
    expect(s.itemsByMonth["2026-10"].map((x) => x.name).sort()).toEqual(["カラー剤", "シャンプー"]);
  });
});
