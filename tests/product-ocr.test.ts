import { describe, expect, it } from "vitest";
import { findSimilarProduct, parseProductOcr } from "../lib/product-ocr";

describe("写真から商品の候補を作る", () => {
  it("1行＝1商品。メーカー・品名・規格・仕入値を、わけて読む", () => {
    const r = parseProductOcr("ミルボン ディーセス シャンプー 500ml 1,200\n  \n---\nナプラ ケアテクト 250ml ¥3,400円\nヘアカラー剤");
    expect(r[0]).toEqual({ maker: "ミルボン", name: "ディーセス シャンプー", spec: "500ml", costPrice: 1200 });
    expect(r[1]).toMatchObject({ maker: "ナプラ", name: "ケアテクト", spec: "250ml", costPrice: 3400 });
    expect(r[2]).toMatchObject({ maker: "", name: "ヘアカラー剤", costPrice: 0 });
    expect(r).toHaveLength(3);
  });
  it("すでにある商品に、にていれば見つける", () => {
    const ex = [{ maker: "ミルボン", name: "ディーセス シャンプー", spec: "500ml" }];
    expect(findSimilarProduct({ maker: "ミルボン", name: "ディーセスシャンプー", spec: "500ml", costPrice: 0 }, ex)).toEqual(ex[0]);
    expect(findSimilarProduct({ maker: "ナプラ", name: "ケアテクト", spec: "250ml", costPrice: 0 }, ex)).toBeNull();
  });
});
