import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

describe("在庫の見える範囲・テスター・スタッフ購入", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {}; let pid = "";
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('t-co','T') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string) =>
      (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
    await mk("office", "1", 4, sid.a); await mk("mgrA", "2", 3, sid.a); await mk("mgrB", "3", 3, sid.b);
    await mk("sA", "4", 1, sid.a); await mk("sA2", "5", 1, sid.a); await mk("sB", "6", 1, sid.b);
    await svc.createProducts(d, u.mgrA, "retail", [{ maker: "髪にドラマを。", name: "シャンプー", spec: "250ml", costPrice: 1500 }], [sid.a, sid.b]);
    pid = (await svc.listProducts(d, u.office, "retail"))[0].id;
  });
  it("在庫は、スタッフも自店だけ見られる。他店は見えない（店長も）。事務員さんは全店", async () => {
    await expect(svc.listStock(d, u.sA, sid.a)).resolves.toBeTruthy();
    expect((await svc.listStock(d, u.sA, sid.b)).items).toHaveLength(0);
    expect((await svc.listStock(d, u.mgrA, sid.b)).items).toHaveLength(0);
    expect((await svc.listStock(d, u.office, sid.b)).items.length).toBeGreaterThan(0);
  });
  it("テスター: 自店のスタッフが記録でき、金額は仕入値×本数で自動。他店には入れられない・見えない", async () => {
    await svc.addTester(d, u.sA, { storeId: sid.a, productId: pid, qty: 2, day: "2026-10-05", note: "テスター" });
    await expect(svc.addTester(d, u.sA, { storeId: sid.b, productId: pid, qty: 1 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addTester(d, u.sA, { storeId: sid.a, productId: pid, qty: 0 })).rejects.toThrow();
    const r = await svc.listTester(d, u.sA2, sid.a, "2026-10");
    expect(r.rows).toHaveLength(1); expect(r.total).toBe(3000);
    expect((await svc.listTester(d, u.sB, sid.a, "2026-10")).rows).toHaveLength(0);
    expect((await svc.listTester(d, u.mgrB, sid.a, "2026-10")).rows).toHaveLength(0);
    expect((await svc.listTester(d, u.office, sid.a, "2026-10")).total).toBe(3000);
    await expect(svc.cancelStockEntry(d, u.sA2, "tester", r.rows[0].id)).rejects.toThrow(svc.ForbiddenError);   // 入れた人以外のスタッフは不可
    await svc.cancelStockEntry(d, u.mgrA, "tester", r.rows[0].id);
    expect((await svc.listTester(d, u.sA, sid.a, "2026-10")).total).toBe(0);
  });
  it("スタッフ購入: 仕入値で記録。見えるのは本人・店長(自店)・事務員さんだけ。月ごとの合計が出る", async () => {
    await svc.addPurchase(d, u.sA, { membershipId: u.sA, productId: pid, qty: 2, day: "2026-10-10" });
    await svc.addPurchase(d, u.mgrA, { membershipId: u.sA2, productId: pid, qty: 1, day: "2026-10-11" });
    await expect(svc.addPurchase(d, u.sA, { membershipId: u.sA2, productId: pid, qty: 1 })).rejects.toThrow(svc.ForbiddenError);   // 他人の分は入れられない
    await expect(svc.addPurchase(d, u.mgrB, { membershipId: u.sA, productId: pid, qty: 1 })).rejects.toThrow(svc.ForbiddenError);   // 他店の店長も不可
    const mine = await svc.listPurchases(d, u.sA, sid.a, "2026-10");
    expect(mine.rows).toHaveLength(1); expect(mine.total).toBe(3000);                      // 自分の分だけ（1500×2）
    const mgr = await svc.listPurchases(d, u.mgrA, sid.a, "2026-10");
    expect(mgr.rows).toHaveLength(2); expect(mgr.total).toBe(4500);
    expect(mgr.byPerson.map((p) => [p.name, p.total])).toEqual([["sA", 3000], ["sA2", 1500]]);
    expect((await svc.listPurchases(d, u.mgrB, sid.a, "2026-10")).rows).toHaveLength(0);
    expect((await svc.listPurchases(d, u.office, sid.a, "2026-10")).total).toBe(4500);
    expect((await svc.listPurchases(d, u.sB, sid.a, "2026-10")).rows).toHaveLength(0);
  });
  it("在庫を管理している商品は、テスター・購入で在庫が減り、取り消すと戻る", async () => {
    await svc.recordMovements(d, u.mgrA, sid.a, [{ productId: pid, kind: "in", qty: 10 }]);
    const qty = async () => (await svc.listStock(d, u.mgrA, sid.a)).items.find((i) => i.productId === pid)!.quantity;
    await svc.addTester(d, u.sA, { storeId: sid.a, productId: pid, qty: 3, day: "2026-10-12" });
    expect(await qty()).toBe(7);
    const row = (await svc.listTester(d, u.sA, sid.a, "2026-10")).rows[0];
    expect(row.stockApplied).toBe(true);
    await svc.cancelStockEntry(d, u.sA, "tester", row.id);
    expect(await qty()).toBe(10);
  });
});
