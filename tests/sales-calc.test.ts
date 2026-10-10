import { describe, expect, it } from "vitest";
import { achievement, newRate, pct1, repeatRate, unitPrice, yoy } from "../lib/sales-calc";

describe("売上の計算", () => {
  it("客単価・新規と再来の割合", () => {
    expect(unitPrice(500000, 80)).toBe(6250);
    expect(unitPrice(500000, 0)).toBeNull();
    expect(newRate(20, 60)).toBe(25);
    expect(repeatRate(20, 60)).toBe(75);
    expect(newRate(0, 0)).toBeNull();
  });
  it("達成率・前年比・お店の中の割合", () => {
    expect(achievement(450000, 500000)).toBe(90);
    expect(achievement(450000, null)).toBeNull();
    expect(yoy(550000, 500000)).toBe(10);
    expect(yoy(450000, 500000)).toBe(-10);
    expect(yoy(1, 0)).toBeNull();
    expect(pct1(300000, 1200000)).toBe(25);
  });
});

import { calcCommission, spaNet } from "../lib/sales-calc";
describe("歩合", () => {
  it("店販10%・着付け25%・メイク20%・ヘッドスパ20%。円未満は切り捨て", () => {
    const r = calcCommission({ retail: 45000, kitsukeSales: 60000, makeupSales: 12345, spaSales: 30000 }, { retail: 10, kitsuke: 25, makeup: 20, spa: 20 });
    expect(r.items.map((i) => i.amount)).toEqual([4500, 15000, 2469, 6000]);
    expect(r.total).toBe(27969);
  });
  it("ヘッドスパは、1人につき1,000円を引いた金額に歩合がつく（1,800円×2人＋4,500円×3人 → 17,100円・5人 → 12,100円の20%＝2,420円）", () => {
    const r = calcCommission({ retail: 0, kitsukeSales: 0, makeupSales: 0, spaSales: 17100, spaCount: 5 }, { retail: 10, kitsuke: 25, makeup: 20, spa: 20 });
    const spa = r.items.find((i) => i.key === "spa")!;
    expect(spa.sales).toBe(12100);
    expect(spa.amount).toBe(2420);
    expect(spa.note).toContain("17,100円 − 1,000円×5人");
    expect(spaNet(3000, 5)).toBe(0);                     // 引いてマイナスにはならない
    expect(spaNet(10000, 0)).toBe(10000);                // 人数が0なら引かない
  });
});
