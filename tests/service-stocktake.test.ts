import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
let stId = "";
const id: Record<string, string> = {};
const st: Record<string, string> = {};

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st.s1); await mk("mgr1", "2", 3, st.s1); await mk("shift1", "3", 2, st.s1); await mk("staff", "4", 1, st.s1); await mk("mgr2", "5", 3, st.s2);
});

describe("商品マスターの登録", () => {
  it("オフィスが、全店共通の商品をまとめて登録できる。同じ商品は飛ばす", async () => {
    const r = await svc.createProducts(db, id.office, "retail", [
      { maker: "ﾐﾙﾎﾞﾝ", name: "ｼｬﾝﾌﾟｰ", spec: "500ml", costPrice: 1200 }, { maker: "ﾐﾙﾎﾞﾝ", name: "ﾄﾘｰﾄﾒﾝﾄ", spec: "500g", costPrice: 1500 },
      { maker: "ﾐﾙﾎﾞﾝ", name: "ｼｬﾝﾌﾟｰ", spec: "500ml", costPrice: 1200 }], [st.s1, st.s2]);
    expect(r).toEqual({ created: 2, skipped: 1 });
  });
  it("1店舗だけで使う商品（店2専用）と、業務用の商品も登録できる", async () => {
    await svc.createProducts(db, id.office, "retail", [{ maker: "ｱﾍﾞﾀﾞ", name: "ｵｲﾙ", spec: "30ml", costPrice: 2000 }], [st.s2]);
    await svc.createProducts(db, id.office, "supply", [{ maker: "ﾙﾍﾞﾙ", name: "ｶﾗｰ剤", spec: "80g", costPrice: 600 }], [st.s1, st.s2]);
    expect((await svc.listProducts(db, id.office, "retail")).length).toBe(3);
    expect((await svc.listProducts(db, id.office, "supply")).length).toBe(1);   // 店販と業務は別の一覧
  });
  it("シフト担当・スタッフも登録できるが、自分のお店だけ（他店には入れられない）。おかしな仕入値は断る", async () => {
    for (const u of [id.shift1, id.staff]) await expect(svc.createProducts(db, u, "retail", [{ name: "x", costPrice: 1 }], [st.s2])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.createProducts(db, id.office, "retail", [{ name: "x", costPrice: 12.5 }], [st.s1])).rejects.toThrow("整数");
    await expect(svc.createProducts(db, id.office, "retail", [{ name: "x", costPrice: -1 }], [st.s1])).rejects.toThrow("整数");
    await expect(svc.createProducts(db, id.office, "retail", [{ name: " ", costPrice: 1 }], [st.s1])).rejects.toThrow("品名");
  });
  it("見える範囲: シフト担当は自店の商品だけ。スタッフは見えない。店長は全部", async () => {
    expect((await svc.listProducts(db, id.shift1, "retail")).map((p) => p.name).sort()).toEqual(["ｼｬﾝﾌﾟｰ", "ﾄﾘｰﾄﾒﾝﾄ"]);
    expect((await svc.listProducts(db, id.staff, "retail")).map((p) => p.name).sort()).toEqual(["ｼｬﾝﾌﾟｰ", "ﾄﾘｰﾄﾒﾝﾄ"]);   // 棚卸しはみんなでやる: 自店の商品は見られる
    expect((await svc.listProducts(db, id.mgr1, "retail")).length).toBe(3);
  });
  it("編集（値上げ・名前変更）・使うお店の変更・取扱い終了ができる", async () => {
    const oil = (await svc.listProducts(db, id.office, "retail")).find((p) => p.name === "ｵｲﾙ")!;
    await svc.updateProduct(db, id.office, oil.id, { maker: "ｱﾍﾞﾀﾞ", name: "ｵｲﾙ", spec: "30ml", costPrice: 2200 });
    await svc.setProductStores(db, id.office, oil.id, [st.s1, st.s2]);
    const after = (await svc.listProducts(db, id.office, "retail")).find((p) => p.id === oil.id)!;
    expect([after.costPrice, after.storeIds.length]).toEqual([2200, 2]);
    await expect(svc.updateProduct(db, id.mgr1, oil.id, { name: "x", costPrice: 1 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.updateProduct(db, id.office, oil.id, { maker: "ﾐﾙﾎﾞﾝ", name: "ｼｬﾝﾌﾟｰ", spec: "500ml", costPrice: 1 })).rejects.toThrow("すでにあります");
    await svc.setProductStores(db, id.office, oil.id, [st.s2]);   // 元に戻す
  });
});

describe("棚卸し", () => {
  it("店長が自店の店販の棚卸しを始める → その店で使う商品だけが並ぶ（店2専用のオイルは入らない）", async () => {
    stId = await svc.startStocktake(db, id.mgr1, st.s1, "retail", "2026-10-31");
    const d = (await svc.getStocktake(db, id.mgr1, stId))!;
    expect(d.items.map((i) => i.name).sort()).toEqual(["ｼｬﾝﾌﾟｰ", "ﾄﾘｰﾄﾒﾝﾄ"]);
    expect(d).toMatchObject({ status: "open", counted: 0, total: 0, editable: true, canManage: true });
  });
  it("同じ日・同じ種類は二重に作れない。始められるのは自店のみんなとオフィス。他店は不可", async () => {
    await expect(svc.startStocktake(db, id.mgr1, st.s1, "retail", "2026-10-31")).rejects.toThrow("すでに作られています");
    await expect(svc.startStocktake(db, id.shift1, st.s2, "supply", "2026-10-31")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.startStocktake(db, id.mgr1, st.s2, "retail", "2026-10-31")).rejects.toThrow(svc.ForbiddenError);
  });
  it("数量は整数・0以上のみ。小数やマイナスは断る。シフト担当も入れられる", async () => {
    const d = (await svc.getStocktake(db, id.shift1, stId))!;
    const [a, b] = d.items;
    await expect(svc.saveQuantities(db, id.shift1, stId, [{ lineId: a.id, quantity: 0.5 }])).rejects.toThrow("整数");
    await expect(svc.saveQuantities(db, id.shift1, stId, [{ lineId: a.id, quantity: -1 }])).rejects.toThrow("整数");
    await svc.saveQuantities(db, id.shift1, stId, [{ lineId: a.id, quantity: 3 }]);
    expect((await svc.getStocktake(db, id.shift1, stId))!.counted).toBe(1);
    await svc.saveQuantities(db, id.staff, stId, [{ lineId: a.id, quantity: 3 }]);   // 棚卸しはみんなでやる: 一般のスタッフも、自店の数量を入れられる
    expect((await svc.getStocktake(db, id.staff, stId))!.counted).toBe(1);
  });
  it("金額 = 仕入値 × 数量、合計(棚卸金額)が出る。未入力の商品があると提出できない", async () => {
    const d = (await svc.getStocktake(db, id.mgr1, stId))!;
    await expect(svc.setStocktakeStatus(db, id.mgr1, stId, "submitted")).rejects.toThrow("未入力の商品が 1 件");
    await svc.saveQuantities(db, id.mgr1, stId, [{ lineId: d.items[1].id, quantity: 4 }]);
    const e = (await svc.getStocktake(db, id.mgr1, stId))!;
    const amounts = Object.fromEntries(e.items.map((i) => [i.name, i.amount]));
    expect(amounts).toEqual({ "ｼｬﾝﾌﾟｰ": 3 * 1200, "ﾄﾘｰﾄﾒﾝﾄ": 4 * 1500 });
    expect(e.total).toBe(3600 + 6000);
  });
  it("商品マスターの値上げ・取扱い終了は、始めた棚卸しの金額に影響しない。追加された商品は「商品を追加」で足せる", async () => {
    const p = (await svc.listProducts(db, id.office, "retail")).find((x) => x.name === "ｼｬﾝﾌﾟｰ")!;
    await svc.updateProduct(db, id.office, p.id, { maker: p.maker, name: p.name, spec: p.spec, costPrice: 9999, status: "discontinued" });
    expect((await svc.getStocktake(db, id.mgr1, stId))!.total).toBe(9600);
    await svc.createProducts(db, id.office, "retail", [{ maker: "ﾐﾙﾎﾞﾝ", name: "新商品", spec: "100ml", costPrice: 500 }], [st.s1]);
    expect(await svc.syncStocktakeProducts(db, id.mgr1, stId)).toBe(1);
    expect(await svc.syncStocktakeProducts(db, id.mgr1, stId)).toBe(0);
    const e = (await svc.getStocktake(db, id.mgr1, stId))!;
    await svc.saveQuantities(db, id.mgr1, stId, [{ lineId: e.items.find((i) => i.name === "新商品")!.id, quantity: 0 }]);   // 0も「入力済み」
    expect((await svc.getStocktake(db, id.mgr1, stId))!.counted).toBe(3);
    // スタッフ(Lv1)も、自分のお店の商品を、棚卸し表の中で追加して表に入れられる
    await svc.createProducts(db, id.staff, "retail", [{ name: "スタッフが足した商品", costPrice: 300 }], [st.s1]);
    expect(await svc.syncStocktakeProducts(db, id.staff, stId)).toBe(1);
    expect((await svc.getStocktake(db, id.staff, stId))!.items.some((i) => i.name === "スタッフが足した商品")).toBe(true);
    // 後のテストに影響しないよう、取り扱いをやめて、行ごと消す
    const np = (await svc.listProducts(db, id.office, "retail")).find((x) => x.name === "スタッフが足した商品")!;
    await svc.updateProduct(db, id.office, np.id, { maker: np.maker, name: np.name, spec: np.spec, costPrice: np.costPrice, status: "discontinued" });
    await db.query("delete from stocktake_lines where stocktake_id = $1 and name = 'スタッフが足した商品'", [stId]);
  });
  it("取扱い終了の商品は、次の棚卸しには出てこない", async () => {
    const t2 = await svc.startStocktake(db, id.office, st.s1, "retail", "2026-11-30");
    expect((await svc.getStocktake(db, id.office, t2))!.items.map((i) => i.name).sort()).toEqual(["新商品", "ﾄﾘｰﾄﾒﾝﾄ"].sort());
    await svc.deleteStocktake(db, id.office, t2);
  });
  it("提出 → 店長は直せない / オフィスは直せて確認済みにできる / 店長は確認済み・後戻り不可", async () => {
    await svc.setStocktakeStatus(db, id.mgr1, stId, "submitted");
    const d = (await svc.getStocktake(db, id.mgr1, stId))!;
    expect(d.editable).toBe(false);
    await expect(svc.saveQuantities(db, id.mgr1, stId, [{ lineId: d.items[0].id, quantity: 1 }])).rejects.toThrow("提出済み");
    await svc.saveQuantities(db, id.office, stId, [{ lineId: d.items[0].id, quantity: 2 }]);
    await expect(svc.setStocktakeStatus(db, id.mgr1, stId, "acknowledged")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStocktakeStatus(db, id.mgr1, stId, "open")).rejects.toThrow(svc.ForbiddenError);
    await svc.setStocktakeStatus(db, id.office, stId, "acknowledged");
    await expect(svc.saveQuantities(db, id.office, stId, [{ lineId: d.items[0].id, quantity: 5 }])).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.listStocktakes(db, id.mgr1, st.s1, "retail"))[0]).toMatchObject({ status: "acknowledged", lines: 3, counted: 3 });
  });
  it("他店の店長は、見えない（自分のお店だけ）。店販と業務の棚卸しは別", async () => {
    expect(await svc.getStocktake(db, id.mgr2, stId)).toBeNull();
    expect(await svc.listStocktakes(db, id.mgr1, st.s1, "supply")).toEqual([]);
    const sup = await svc.startStocktake(db, id.mgr1, st.s1, "supply", "2026-10-31");
    expect((await svc.getStocktake(db, id.mgr1, sup))!.items.map((i) => i.name)).toEqual(["ｶﾗｰ剤"]);
  });
});

describe("棚卸しの合算（店販・業務・店舗・全店）", () => {
  it("店販は店販、業務は業務で計算し、お店ごとの合算と全店の合算が出る", async () => {
    // 店1: 店販 R8.10.31（上のテストで 3,600円＋6,000円… 確認済みで合計は既存）／業務 10/31（ｶﾗｰ剤を未入力→0円）。店2: 業務 10/31 を作って ｶﾗｰ剤 × 5 = 3,000円
    const s1 = (await svc.listStocktakes(db, id.office, st.s1, "retail"))[0];
    const sup1 = (await svc.listStocktakes(db, id.office, st.s1, "supply"))[0];
    const d1 = (await svc.getStocktake(db, id.office, sup1.id))!;
    await svc.saveQuantities(db, id.mgr1, sup1.id, [{ lineId: d1.items[0].id, quantity: 7 }]);                // 店1 業務: 600×7 = 4,200
    const sup2 = await svc.startStocktake(db, id.office, st.s2, "supply", "2026-10-31");
    const d2 = (await svc.getStocktake(db, id.office, sup2))!;
    await svc.saveQuantities(db, id.office, sup2, [{ lineId: d2.items[0].id, quantity: 5 }]);                // 店2 業務: 600×5 = 3,000
    await svc.startStocktake(db, id.office, st.s1, "retail", "2026-11-30");                                   // 別の日（合算には入らない）

    const sum = await svc.stocktakeSummary(db, id.office, "2026-10-31");
    const a = sum.stores.find((x) => x.storeId === st.s1)!, b = sum.stores.find((x) => x.storeId === st.s2)!;
    expect(a.retail!.total).toBe(s1.total);                       // 店販だけの合計
    expect(a.supply!.total).toBe(4200);                           // 業務だけの合計
    expect(a.total).toBe(s1.total + 4200);                        // お店の合算（店販＋業務）
    expect(b.retail).toBeNull(); expect(b.supply!.total).toBe(3000); expect(b.total).toBe(3000);
    expect(sum.retailTotal).toBe(s1.total); expect(sum.supplyTotal).toBe(7200);
    expect(sum.grandTotal).toBe(s1.total + 7200);                 // 全店の合算
    expect(sum.stores).toHaveLength(2);
  });
  it("見える範囲だけ合算される: 店長は他店も、シフト担当は自店だけ。日が違えば別", async () => {
    expect((await svc.stocktakeSummary(db, id.mgr1, "2026-10-31")).stores).toHaveLength(1);   // 店長は自分のお店だけ。全店は事務員さん・鬼塚さん・制作者だけ
    expect((await svc.stocktakeSummary(db, id.office, "2026-10-31")).stores).toHaveLength(2);
    const own = await svc.stocktakeSummary(db, id.shift1, "2026-10-31");
    expect(own.stores.map((x) => x.storeId)).toEqual([st.s1]);
    expect(own.grandTotal).toBe(own.stores[0].total);
    expect((await svc.stocktakeSummary(db, id.office, "2026-12-31")).grandTotal).toBe(0);
    expect(await svc.listStocktakeDates(db, id.office)).toEqual(["2026-11-30", "2026-10-31"]);
    await expect(svc.stocktakeSummary(db, id.office, "x")).rejects.toThrow("棚卸日");
  });
  it("商品マスターの仕入値を変えても、過去の合算は変わらない", async () => {
    const before = (await svc.stocktakeSummary(db, id.office, "2026-10-31")).grandTotal;
    const kara = (await svc.listProducts(db, id.office, "supply"))[0];
    await svc.updateProduct(db, id.office, kara.id, { maker: kara.maker, name: kara.name, spec: kara.spec, costPrice: 99999 });
    expect((await svc.stocktakeSummary(db, id.office, "2026-10-31")).grandTotal).toBe(before);
  });
});

describe("昨年のデータの取り込みと、前回の数量を引きついだ棚卸し", () => {
  it("取り込んだ昨年の数量から今年が始まり、数量を直すと金額が変わる。取り込めるのは正美さんだけ", async () => {
    const text = "メーカー\t品名\t規格\t仕入値\t数量\t金額\nアヴェダ\tシャンプー\t200ml\t1,500\t3\t4500\nアヴェダ\tリンス\t200ml\t1200\t2\t2400\n\t\t\t\t2025.10.31 棚卸金額\t6900";
    await expect(svc.importPastStocktake(db, id.mgr1, st.s1, "retail", "2025-10-31", text)).rejects.toThrow(svc.ForbiddenError);
    const r = await svc.importPastStocktake(db, id.office, st.s1, "retail", "2025-10-31", text);
    expect(r).toMatchObject({ lines: 2, total: 6900 });
    const now = await svc.startStocktake(db, id.office, st.s1, "retail", "2025-11-30");
    const d0 = (await svc.getStocktake(db, id.office, now))!;
    expect(d0.items.every((i) => i.quantity === null)).toBe(true);      // 自動では入らない（ボタンでコピーする）
    expect(d0.prevOn).toBe("2025-10-31");
    await svc.deleteStocktakeLine(db, id.office, d0.items[0].id);
    const cp = await svc.copyPreviousStocktake(db, id.office, now, false);
    expect(cp).toMatchObject({ copied: 2, added: 1 });
    const d = (await svc.getStocktake(db, id.office, now))!;
    expect(d.prevOn).not.toBeNull();
    const sh = d.items.find((i) => i.name === "シャンプー" && i.spec === "200ml")!;
    await svc.editStocktakeLine(db, id.office, sh.id, { maker: sh.maker, name: "シャンプー(改)", spec: sh.spec, costPrice: 1500 });
    expect((await svc.getStocktake(db, id.office, now))!.items.find((i) => i.id === sh.id)!.name).toBe("シャンプー(改)");
    await svc.saveQuantities(db, id.office, now, [{ lineId: sh.id, quantity: 5 }]);
    expect((await svc.getStocktake(db, id.office, now))!.items.find((i) => i.id === sh.id)!.amount).toBe(7500);
  });
});

const parsePastStocktakeAllForTest = svc.parsePastStocktakeAll;
describe("全店まとめての取り込み", () => {
  it("店舗名・区分つきの表を、お店×店販/業務ごとに取り込む。お店の名前は少し違っても合わせる", async () => {
    const text = "店舗名\t区分\tメーカー\t品名\t規格\t単価\t数量\t金額\t備考\ns1\t店販\tミルボン\tオイル\t100ml\t2000\t2\t4000\t\nS2\t業務\tウェラ\tカラー 6\t80g\t750\t3\t2250\t数量空欄\n存在しない店\t業務\tX\tY\t1\t100\t1\t100\t";
    const r = await svc.importPastStocktakeAll(db, id.office, "2024-10-31", text);
    expect(r.groups.filter((g) => !g.error).map((g) => g.total).sort()).toEqual([2250, 4000]);
    expect(r.groups.some((g) => g.error)).toBe(true);
    await expect(svc.importPastStocktakeAll(db, id.mgr1, "2024-10-31", text)).rejects.toThrow(svc.ForbiddenError);
    // 「原本頁」つきの10列。列がずれた行（メーカー抜け）や、金額が合わない行は取り込まない
    const t2 = "店舗名\t区分\t原本頁\tメーカー\t品名\t規格\t単価\t数量\t金額\t備考\ns1\t店販\t1\tAVEDA\tシャンプー\t250ml\t2280\t3\t6840\t\ns1\t店販\t5\tスムーズ シャンプー\t250ml\t2280\t3\t6840";
    const r2 = parsePastStocktakeAllForTest(t2);
    expect(r2.rows).toHaveLength(1);
    expect(r2.bad).toHaveLength(1);
  });
});

describe("メーカー名のそろえ", () => {
  it("ウェラは、取り込むときにウエラにそろう", () => {
    const r = svc.parsePastStocktakeAll("店舗名\t区分\tメーカー\t品名\t規格\t単価\t数量\t金額\nATENA\t業務\tウェラ\tカラー\t80g\t750\t1\t750");
    expect(r.rows[0].maker).toBe("ウエラ");
  });
});

describe("Pythonスクリプトをそのまま貼ったとき", () => {
  it("リストの行を読む。区分の直し・ウェラ→ウエラ・メーカー抜けの行も扱う。金額が合わない行は取り込まない", () => {
    const t = `data_all = []\nfuk = [\n    ["ATENA福津", "業務", 5, "ミルボン", "オージュア インメトリィ コントロールクリーム", "135g", 2600, 1, 2600, ""],\n    ["ATENA", "業務", 1, "ウェラ", "コレストンパーフェクト 9/71", "80g", 750, 2, 1500, "メモ"],\n    ["ATENA AVEDA", "店販", 5, "スムーズインフュージョン シャンプー", "250ml", 2280, 3, 6840, ""],\n    ["ATENA", "業務", 1, "ウェラ", "壊れた行", "80g", 750, 2, 999, ""]\n]\nwb.save("x.xlsx")`;
    const r = svc.parsePastStocktakeAll(t);
    expect(r.rows.map((x) => [x.store, x.kind, x.maker, x.name])).toEqual([
      ["ATENA福津", "retail", "ミルボン", "オージュア インメトリィ コントロールクリーム"],
      ["ATENA", "supply", "ウエラ", "コレストンパーフェクト 9/71"],
      ["ATENA AVEDA", "retail", "", "スムーズインフュージョン シャンプー"],
    ]);
    expect(r.bad).toHaveLength(1);
  });
});
