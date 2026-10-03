import { describe, expect, it } from "vitest";
import { parseOrderText } from "../lib/material-ocr";

describe("発注画面の読み取り", () => {
  it("商品名・数量・金額を取り出し、合計の行は明細にしない", () => {
    const r = parseOrderText(`ご注文内容
ミルボン オージュア シャンプー 1000ml ×2 ¥7,600
カラー剤 6G 12個 14,400円
ＬＥＯ ヘアオイル　３，２００
小計 ¥25,200
送料 ¥0
合計 ¥25,200`);
    expect(r.lines).toEqual([
      { name: "ミルボン オージュア シャンプー 1000ml", qty: 2, amount: 7600 },
      { name: "カラー剤 6G", qty: 12, amount: 14400 },
      { name: "ＬＥＯ ヘアオイル", qty: 1, amount: 3200 },
    ]);
    expect(r.total).toBe(25200);
  });
  it("数字だけの行や短すぎる行は無視する", () => {
    expect(parseOrderText("1,200\n12\nあ 500").lines).toEqual([]);
  });
});

import { applyMemory, findSupplier, learnName, similarity } from "../lib/material-ocr";
describe("学習", () => {
  const mem = { items: ["ミルボン オージュア シャンプー", "カラー剤 6G"], aliases: [{ raw: "カラ一剤 66", name: "カラー剤 6G" }], suppliers: ["○○商事", "ALBUM物販"] };
  it("にている名前は、今までの名前に合わせる", () => {
    expect(similarity("ミルボン オージュア シャンプ一", "ミルボン オージュア シャンプー")).toBeGreaterThan(0.8);
    expect(learnName("ミルボン オージュア シャンプ一", mem)).toBe("ミルボン オージュア シャンプー");
    expect(learnName("カラ一剤 66", mem)).toBe("カラー剤 6G");        // 前に直した読み間違い
    expect(learnName("全然ちがう商品", mem)).toBe("全然ちがう商品");
  });
  it("直したあとも、元の読み取り文字を覚えておく", () => {
    expect(applyMemory([{ name: "ミルボン オージュア シャンプ一", qty: 1, amount: 100 }], mem)[0]).toMatchObject({ name: "ミルボン オージュア シャンプー", raw: "ミルボン オージュア シャンプ一" });
  });
  it("文章の中から発注先を見つける", () => {
    expect(findSupplier("ご注文 ○○商事 御中", mem.suppliers)).toBe("○○商事");
    expect(findSupplier("なし", mem.suppliers)).toBeNull();
  });
});
