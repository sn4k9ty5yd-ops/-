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
