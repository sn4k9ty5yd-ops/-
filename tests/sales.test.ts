import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};
const V = (total: number, customers: number, over: Partial<svc.SalesValues> = {}): svc.SalesValues => ({ ...svc.EMPTY_SALES, total, customers, ...over });

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('s-co','S') returning id")).rows[0].id;
  for (const n of ["A店", "B店"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string, name: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
  await mk("office", "1", 4, st["A店"], "事務員"); await mk("mgr", "2", 3, st["A店"], "A店長");
  await mk("a", "3", 1, st["A店"], "山田"); await mk("shift", "7", 2, st["A店"], "シフト担当"); await mk("a2", "4", 1, st["A店"], "佐藤"); await mk("b", "5", 1, st["B店"], "他店"); await mk("mgrB", "6", 3, st["B店"], "B店長");
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
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-10")).rows.map((r) => [r.name, r.total])).toEqual([["A店長", 0], ["山田", 500000], ["佐藤", 320000], ["シフト担当", 0]]);
    expect((await svc.listSalesMonth(db, id.mgrB, st["A店"], "2026-10")).rows.every((r) => r.total === 0)).toBe(true);        // 他店は見えない
    const mine = await svc.getMySales(db, id.a, "2026-10");
    expect(mine.mine?.total).toBe(500000);
    expect(mine.store).toEqual({ total: 0, customers: 0 });                                                      // 一般のスタッフには、お店の合計は見せない
    expect((await svc.getMySales(db, id.mgr, "2026-10")).store).toEqual({ total: 820000, customers: 132 });      // 店長には見える
    expect((await svc.getMySales(db, id.a2, "2026-10")).mine?.total).toBe(320000);
  });

  it("前年との比較・目標・達成率の材料が揃う。個人の目標は本人とお店の人にだけ", async () => {
    await svc.saveSales(db, id.mgr, st["A店"], "2025-10", [{ membershipId: id.a, values: V(400000, 70) }, { membershipId: id.a2, values: V(350000, 60) }], "import");
    const m = await svc.getMySales(db, id.a, "2026-10");
    expect(m.prev?.total).toBe(400000);
    expect((await svc.getMySales(db, id.mgr, "2026-10")).storePrev.total).toBe(750000);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", null, 1000000);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", id.a, 600000);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", id.a2, 300000);
    const m2 = await svc.getMySales(db, id.a, "2026-10");
    expect([m2.storeTarget, m2.target]).toEqual([null, 600000]);                                  // 他の人の目標は見えない
    await expect(svc.setSalesTarget(db, id.a, st["A店"], "2026-10", id.a, 1)).rejects.toThrow(svc.ForbiddenError);
    await svc.setSalesTarget(db, id.mgr, st["A店"], "2026-10", id.a, null);
    expect((await svc.getMySales(db, id.a, "2026-10")).target).toBeNull();
    const ed = await svc.listSalesMonth(db, id.mgr, st["A店"], "2026-10");
    expect(ed.storeTarget).toBe(1000000); expect(ed.prev[id.a].total).toBe(400000); expect(ed.targets[id.a2]).toBe(300000);
  });

  it("店内ランキング: 順位がつく。お店の設定でスタッフには見せなくできる（店長・管理者にはいつでも）", async () => {
    const b = (await svc.getMySales(db, id.mgr, "2026-10")).board;
    expect(b.map((x) => [x.rank, x.name, x.total])).toEqual([[1, "山田", 500000], [2, "佐藤", 320000]]);
    await svc.setSalesBoardPublic(db, id.office, st["A店"], false);
    expect((await svc.getMySales(db, id.a, "2026-10")).board).toHaveLength(0);                                    // 一般のスタッフには、いつも見せない
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

  it("売上の流れ: 本人が記入して提出 → 店長が確認 → 事務員さんが確定。順番は飛ばせない。提出前の数字はランキングに入らない", async () => {
    const M = "2026-12";
    await svc.saveMySales(db, id.a, M, V(480000, 75, { free: 100000, nominated: 330000, retail: 50000, newCustomers: 15, repeatCustomers: 60 }));
    let mine = await svc.getMySales(db, id.a, M);
    expect(mine.status).toBe("draft");
    expect((await svc.getMySales(db, id.mgr, M)).board).toHaveLength(0);                                   // 下書きは数えない
    await expect(svc.reviewSales(db, id.mgr, id.a, M, "manager_ok")).rejects.toThrow("できません");           // 提出前は確認できない
    expect(await svc.submitMySales(db, id.a, M)).toBe("submitted");
    expect((await svc.listNotifications(db, id.mgr)).items.some((n) => n.title.includes("売上が提出されました"))).toBe(true);
    await expect(svc.saveMySales(db, id.a, M, V(1, 1))).rejects.toThrow("直せません");                       // 提出後は本人は直せない
    await expect(svc.submitMySales(db, id.a, M)).rejects.toThrow("すでに");
    expect((await svc.getMySales(db, id.mgr, M)).board.map((b) => b.name)).toEqual(["山田"]);                 // 提出したら数える
    // 順番: 事務員さんは、店長確認のあと。店長は事務員の分はできない・他店・自分の分はできない
    await expect(svc.reviewSales(db, id.office, id.a, M, "office_ok")).rejects.toThrow("店長の確認");
    await expect(svc.reviewSales(db, id.mgrB, id.a, M, "manager_ok")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reviewSales(db, id.a2, id.a, M, "manager_ok")).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.reviewSales(db, id.mgr, id.a, M, "manager_ok")).toBe("manager_ok");
    expect((await svc.listNotifications(db, id.office)).items.some((n) => n.title.includes("店長が確認"))).toBe(true);
    await expect(svc.reviewSales(db, id.mgr, id.a, M, "office_ok")).rejects.toThrow(svc.ForbiddenError);       // 確定は事務員さんだけ
    expect(await svc.reviewSales(db, id.office, id.a, M, "office_ok")).toBe("office_ok");
    expect((await svc.getMySales(db, id.a, M)).status).toBe("office_ok");
    expect((await svc.listNotifications(db, id.a)).items.some((n) => n.title.includes("確定しました"))).toBe(true);
    // 確定後: 店長は直接直せない／差し戻せない。事務員さんは差し戻せる
    await expect(svc.saveSales(db, id.mgr, st["A店"], M, [{ membershipId: id.a, values: V(1, 1) }])).rejects.toThrow("差し戻し");
    await expect(svc.reviewSales(db, id.mgr, id.a, M, "return", "x")).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.reviewSales(db, id.office, id.a, M, "return", "客数がちがいます")).toBe("returned");
    mine = await svc.getMySales(db, id.a, M);
    expect(mine).toMatchObject({ status: "returned", returnComment: "客数がちがいます" });
    expect((await svc.listNotifications(db, id.a)).items.some((n) => n.title.includes("差し戻されました"))).toBe(true);
    await svc.saveMySales(db, id.a, M, V(480000, 78, { newCustomers: 15, repeatCustomers: 63 }));           // 直して
    expect(await svc.submitMySales(db, id.a, M)).toBe("submitted");                                          // もう一度提出
  });

  it("店長の売上は、店長の確認をとばして事務員さんの確認へ。店長が代わりに入れた数字は「提出済み」になる。管理者の前年の取り込みは確定", async () => {
    const M = "2026-12";
    await svc.saveMySales(db, id.mgr, M, V(900000, 120));
    expect(await svc.submitMySales(db, id.mgr, M)).toBe("manager_ok");
    expect(await svc.reviewSales(db, id.office, id.mgr, M, "office_ok")).toBe("office_ok");
    await expect(svc.reviewSales(db, id.mgr, id.mgr, M, "return")).rejects.toThrow("自分");
    await svc.saveSales(db, id.mgr, st["A店"], M, [{ membershipId: id.a2, values: V(280000, 45) }]);        // 店長が写真を見て入れた
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], M)).rows.find((r) => r.membershipId === id.a2)?.status).toBe("submitted");
    await svc.saveSales(db, id.office, st["A店"], "2025-12", [{ membershipId: id.a2, values: V(250000, 40) }], "import");
    expect((await svc.listSalesMonth(db, id.office, st["A店"], "2025-12")).rows.find((r) => r.membershipId === id.a2)?.status).toBe("office_ok");
    await expect(svc.saveMySales(db, id.office, M, V(1, 1))).rejects.toThrow(svc.ForbiddenError);              // 管理者は個人の売上は持たない
  });

  it("着付け・メイク・ヘッドスパの人数と売上を記入でき、歩合をシフト担当・店長がつけられる（本人・他の人・確定後は不可）", async () => {
    const M = "2027-01";
    await svc.saveMySales(db, id.a, M, V(500000, 70, { retail: 45000, retailCount: 9, kitsukeCount: 3, kitsukeSales: 60000, makeupCount: 4, makeupSales: 40000, spaCount: 5, spaSales: 25000 }));
    const mine = await svc.getMySales(db, id.a, M);
    expect(mine.mine).toMatchObject({ kitsukeCount: 3, kitsukeSales: 60000, spaSales: 25000, retailCount: 9 });
    expect(mine.rates).toEqual({ retail: 10, kitsuke: 25, makeup: 20, spa: 20 });
    await expect(svc.setSalesCommission(db, id.mgr, id.a, M, 1000)).rejects.toThrow("提出されたあと");        // 提出前はつけられない
    await svc.submitMySales(db, id.a, M);
    await expect(svc.setSalesCommission(db, id.a, id.a, M, 1000)).rejects.toThrow(svc.ForbiddenError);          // 本人はつけられない
    await expect(svc.setSalesCommission(db, id.a2, id.a, M, 1000)).rejects.toThrow(svc.ForbiddenError);         // ふつうのスタッフは不可
    await expect(svc.setSalesCommission(db, id.mgrB, id.a, M, 1000)).rejects.toThrow(svc.ForbiddenError);       // 他店は不可
    await expect(svc.setSalesCommission(db, id.shift, id.a, M, 27500)).rejects.toThrow(svc.ForbiddenError);       // シフト担当(Lv2)はつけられない
    await svc.setSalesCommission(db, id.mgr, id.a, M, 27500);                                                   // 店長はつけられる
    expect((await svc.getMySales(db, id.a, M)).commission).toBe(27500);
    expect((await svc.listNotifications(db, id.a)).items.some((n) => n.title.includes("歩合が決まりました"))).toBe(true);
    // シフト担当は、他の人の売上は見えない。数字の直しと確認もできない
    expect((await svc.listSalesMonth(db, id.shift, st["A店"], M)).rows.find((r) => r.membershipId === id.a)?.total ?? 0).toBe(0);
    await expect(svc.saveSales(db, id.shift, st["A店"], M, [{ membershipId: id.a, values: V(1, 1) }])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reviewSales(db, id.shift, id.a, M, "manager_ok")).rejects.toThrow(svc.ForbiddenError);
    await svc.reviewSales(db, id.mgr, id.a, M, "manager_ok"); await svc.reviewSales(db, id.office, id.a, M, "office_ok");
    await expect(svc.setSalesCommission(db, id.mgr, id.a, M, 30000)).rejects.toThrow("確定");
    await svc.setSalesRates(db, id.office, { retail: 12, kitsuke: 25, makeup: 20, spa: 20 });
    expect((await svc.getSalesRates(db, id.mgr)).retail).toBe(12);
    await expect(svc.setSalesRates(db, id.mgr, { retail: 1, kitsuke: 1, makeup: 1, spa: 1 })).rejects.toThrow(svc.ForbiddenError);
    await svc.setSalesRates(db, id.office, { retail: 10, kitsuke: 25, makeup: 20, spa: 20 });
  });

  it("提出期限: 決めなければ月末。店長が決められる。前日・当日・翌日に通知が届く（1回だけ）", async () => {
    const M = "2027-02";
    expect((await svc.listSalesMonth(db, id.mgr, st["A店"], M))).toMatchObject({ dueOn: "2027-02-28", dueIsDefault: true });
    await svc.setSalesDeadline(db, id.mgr, st["A店"], M, "2027-02-25");
    expect((await svc.getMySales(db, id.a, M)).dueOn).toBe("2027-02-25");
    await expect(svc.setSalesDeadline(db, id.a, st["A店"], M, "2027-02-20")).rejects.toThrow(svc.ForbiddenError);
    await svc.submitMySales(db, id.a2, M).catch(() => {});                                                       // a2: 下書きなし
    await svc.saveMySales(db, id.a, M, V(100000, 10)); await svc.submitMySales(db, id.a, M);                      // a は提出済み
    const n0 = (await svc.listNotifications(db, id.a2)).items.length;
    expect(await svc.runSalesReminders(db, true, "2027-02-24T08:00:00Z")).toBe(0);                               // 9時前は送らない
    const sent = await svc.runSalesReminders(db, true, "2027-02-24T09:10:00Z");                                  // 前日
    expect(sent).toBeGreaterThan(0);
    const t2 = (await svc.listNotifications(db, id.a2)).items.map((n) => n.title);
    expect(t2.some((t) => t.includes("明日（2/25）までです"))).toBe(true);
    expect((await svc.listNotifications(db, id.a)).items.some((n) => n.title.includes("明日（2/25）"))).toBe(false);   // 出した人には送らない
    expect(await svc.runSalesReminders(db, true, "2027-02-24T10:00:00Z")).toBe(0);                               // 同じ日に2回は送らない
    expect((await svc.listNotifications(db, id.a2)).items.length).toBe(n0 + 1);
    await svc.runSalesReminders(db, true, "2027-02-26T09:00:00Z");                                               // 翌日: 期限切れ
    expect((await svc.listNotifications(db, id.mgr)).items.some((n) => n.title.includes("未提出です"))).toBe(true);
    expect((await svc.listNotifications(db, id.a2)).items.some((n) => n.title.includes("期限") && n.title.includes("過ぎています"))).toBe(true);
  });
});
