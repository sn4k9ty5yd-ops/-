import { describe, expect, it } from "vitest";
import { parseUsageText, readQty } from "../lib/usage-ocr";

const P = [
  { id: "a", maker: "髪にドラマを。", name: "シャンプー", spec: "250ml" },
  { id: "b", maker: "髪にドラマを。", name: "トリートメント", spec: "250g" },
  { id: "c", maker: "ミルボン", name: "エルジューダ オイル", spec: "120ml" },
];
describe("写真の文字から、業務に回した商品と本数を読む", () => {
  it("本数の書き方（×2・2本・行の終わりの数字・書いてなければ1）", () => {
    expect(readQty("シャンプー ×2").qty).toBe(2);
    expect(readQty("トリートメント 3本").qty).toBe(3);
    expect(readQty("オイル 4").qty).toBe(4);
    expect(readQty("シャンプー").qty).toBe(1);
  });
  it("商品名が少し読み間違っていても、にている商品に合わせる。合わないものは空にする", () => {
    const r = parseUsageText("髪にドラマを。 シャンプー ×2\nトリートメソト 1本\nぜんぜんちがう品 1\n合計 3本\n", P);
    expect(r.map((x) => [x.productId, x.qty])).toEqual([["a", 2], ["b", 1], [null, 1]]);
  });
});
