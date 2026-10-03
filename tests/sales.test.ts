import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};
const V = (total: number, customers: number, over: Partial<svc.SalesValues> = {}): svc.SalesValues => ({ total, free: 0, nominated: 0, retail: 0, customers, newCustomers: 0, repeatCustomers: 0, ...over });

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('s-co','S') returning id")).rows[0].id;
  for (const n of ["A店", "B店"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string, name: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
  await mk("office", "1", 4, st["A店"], "事務員"); await mk("mgr", "2", 3, st["A店"], "A店長");
  await mk("a", "3", 1, st["A店"], "山田"); await mk("a2", "4", 1, st["A店"], "佐藤"); await mk("b", "5", 1, st["B店"], "他店"); await mk("mgrB", "6", 3, st["B店"], "B店長");
});

describe("指名売上", () => {
  it("店長が自店の全員の数字を入れられる。スタッフ・他店の店長は入れられない。管理者は全店", async () => {
    expect(await svc.saveSales(db, id.mgr, st["A店"], "2026-10", [
      { membershipId: id.a, values: V(500000, 80, { free: 200000, nominated: 250000, retail: 50000, newCustomers: 20, repeatCustomers: 60 }) },
      { membershipId: id.a2, values: V(300000, 50) }])).toBe(2);
    await expect(svc.saveSales(db, id.a, st["A店"], "2026-10", [{ membershipId: id.a, values: V(1, 1) }])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.saveSales(db, id.mgrB, st["A店"], "2026-10", [{ membershipId: id.a, values: V(1, 1) }])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.saveSales(db, id.mgr, st["A店"], "2026-10", [{ membershipId: id.b, values: V(1, 1) }])).rejects.toThrow(svc.ForbiddenError);   // 他店の人は対象にできない
    await expect(svc.saveSales(db, id.office, st["B店"], "2026-10", [{ membershipId: id.b, values: V(200000, 30) }])).resolves.toBe(1);
  });

  it("1人でも不正なら、全員取り消し。数字は整数のみ", async () => {
    await expect(svc.saveSales(db, id.mgr, st["A店"], "2026-11", [{ membershipId: id.a, values: V(10, 1) }, { membershipId: id.a2, values: V(-5, 1) }])).rejects.toThrow("整数");
    await expect(svc.saveSales(db, id.mgr, st["A店"], "2026-11", [{ membershipId: id.a, values: V(10, 1) }, { membershipId: id.b, values: V(5, 1) }])).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-11")).rows.every((r) => r.total === 0)).toBe(true);
    await svc.saveSales(db, id.mgr, st["A店"], "2026-10", [{ membershipId: id.a2, values: V(320000, 52) }]);                                         // 上書き
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-10")).rows.find((r) => r.membershipId === id.a2)?.total).toBe(320000);
  });

  it("見られる範囲: 店長は自店の全員、管理者は全店、スタッフは自分だけ。お店の合計は本人にも見える", async () => {
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-10")).rows.map((r) => [r.name, r.total])).toEqual([["A店長", 0], ["山田", 500000], ["佐藤", 320000]]);
    expect((await svc.listSalesMonth(db, id.mgrB, st["A店"], "2026-10")).rows.every((r) => r.total === 0)).toBe(true);        // 他店は見えない
    const mine = await svc.getMySales(db, id.a, "2026-10");
    expect(mine.mine?.total).toBe(500000);
    expect(mine.store).toEqual({ total: 820000, customers: 132 });
    expect((await svc.getMySales(db, id.a2, "2026-10")).mine?.total).toBe(320000);
  });

  it("前年との比較・目標・達成率の材料が揃う。個人の目標は本人とお店の人にだけ", async () => {
    await svc.saveSales(db, id.mgr, st["A店"], "2025-10", [{ membershipId: id.a, values: V(400000, 70) }, { membershipId: id.a2, values: V(350000, 60) }], "import");
    const m = await svc.getMySales(db, id.a, "2026-10");
    expect(m.prev?.total).toBe(400000);
    expect(m.storePrev.total).toBe(750000);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", null, 1000000);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", id.a, 600000);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", id.a2, 300000);
    const m2 = await svc.getMySales(db, id.a, "2026-10");
    expect([m2.storeTarget, m2.target]).toEqual([1000000, 600000]);                                  // 他の人の目標は見えない
    await expect(svc.setSalesTarget(db, id.a, st["A店"], "2026-10", id.a, 1)).rejects.toThrow(svc.ForbiddenError);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", id.a, null);
    expect((await svc.getMySales(db, id.a, "2026-10")).target).toBeNull();
    const ed = await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-10");
    expect(ed.storeTarget).toBe(1000000); expect(ed.prev[id.a].total).toBe(400000); expect(ed.targets[id.a2]).toBe(300000);
  });

  it("店内ランキング: 順位がつく。お店の設定でスタッフには見せなくできる（店長・管理者にはいつでも）", async () => {
    const b = (await svc.getMySales(db, id.a, "2026-10")).board;
    expect(b.map((x) => [x.rank, x.name, x.total])).toEqual([[1, "山田", 500000], [2, "佐藤", 320000]]);
    await svc.setSalesBoardPublic(db, id.office, st["A店"], false);
    expect((await svc.getMySales(db, id.a, "2026-10")).board).toHaveLength(0);
    expect((await svc.getMySales(db, id.mgr, "2026-10")).board).toHaveLength(2);
    await expect(svc.setSalesBoardPublic(db, id.mgr, st["A店"], true)).rejects.toThrow(svc.ForbiddenError);                // 切りかえは管理者だけ
    await svc.setSalesBoardPublic(db, id.office, st["A店"], true);
  });

  it("24か月の推移が出る", async () => {
    const s = (await svc.getMySales(db, id.a, "2026-10")).series;
    expect(s.map((x) => x.month)).toEqual(["2025-10", "2026-10"]);
  });

  it("レジ画面の写真: 店長・管理者だけ。今月と先月より前は自動で消える。数字は残る", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const iid = await svc.addSalesImage(db, id.mgr, st["A店"], "2026-08", "image/png", png);
    await expect(svc.addSalesImage(db, id.a, st["A店"], "2026-08", "image/png", png)).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-08")).images).toHaveLength(1);
    expect(await svc.getSalesImage(db, id.a, iid)).toBeNull();
    await svc.purgeOldMaterialImages(db, true, "2026-09-30");
    expect(await svc.getSalesImage(db, id.mgr, iid)).not.toBeNull();       // 9月: 8月は先月なので残る
    await svc.purgeOldMaterialImages(db, true, "2026-10-01");
    expect(await svc.getSalesImage(db, id.mgr, iid)).toBeNull();           // 10月: 消える
    expect((await svc.getMySales(db, id.a, "2026-10")).mine?.total).toBe(500000);
  });
});
