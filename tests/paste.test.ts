import { describe, expect, it } from "vitest";
import { reiwaDot } from "../lib/era";
import { parsePrice, parseProductPaste } from "../lib/paste";

describe("金額の読み取り", () => {
  it("カンマ・円・全角を読める", () => {
    expect(parsePrice("1,200")).toBe(1200); expect(parsePrice("¥1,200")).toBe(1200); expect(parsePrice("1200円")).toBe(1200);
    expect(parsePrice("１，２００")).toBe(1200); expect(parsePrice("0")).toBe(0);
  });
  it("数字でないもの・小数・マイナスは読めない", () => {
    expect(parsePrice("")).toBeNull(); expect(parsePrice("abc")).toBeNull(); expect(parsePrice("12.5")).toBeNull(); expect(parsePrice("-5")).toBeNull();
  });
});

describe("Excelから貼り付けた表の読み取り", () => {
  it("タブ区切り4列（メーカー・品名・規格・仕入値）。見出し行は飛ばす", () => {
    const r = parseProductPaste("ﾒｰｶｰ\t品   名\t規格\t仕入値\nﾐﾙﾎﾞﾝ\tｼｬﾝﾌﾟｰ\t500ml\t1,200\nﾙﾍﾞﾙ\tｵｲﾙ\t30ml\t2000\n");
    expect(r.skippedHeader).toBe(true);
    expect(r.items).toEqual([{ maker: "ﾐﾙﾎﾞﾝ", name: "ｼｬﾝﾌﾟｰ", spec: "500ml", costPrice: 1200 }, { maker: "ﾙﾍﾞﾙ", name: "ｵｲﾙ", spec: "30ml", costPrice: 2000 }]);
    expect(r.badLines).toEqual([]);
  });
  it("カンマ区切り・3列・2列も読める", () => {
    const r = parseProductPaste("ｼｬﾝﾌﾟｰ,500ml,1200\nﾄﾘｰﾄﾒﾝﾄ,1500");
    expect(r.items.map((i) => [i.name, i.spec, i.costPrice])).toEqual([["ｼｬﾝﾌﾟｰ", "500ml", 1200], ["ﾄﾘｰﾄﾒﾝﾄ", "", 1500]]);
  });
  it("おかしな行は、行番号つきで報告し、ほかの行は読む", () => {
    const r = parseProductPaste("ﾐﾙﾎﾞﾝ\tｼｬﾝﾌﾟｰ\t500ml\t1200\nﾐﾙﾎﾞﾝ\tｵｲﾙ\t30ml\t高い\n\t\t\t500\n");
    expect(r.items).toHaveLength(1);
    expect(r.badLines.map((b) => [b.line, b.reason])).toEqual([[2, "仕入値が数字ではありません"], [3, "品名がありません"]]);
  });
  it("空の貼り付けは何も作らない", () => expect(parseProductPaste("  \n\n").items).toEqual([]));
});

describe("棚卸日の書き方", () => {
  it("2026-10-31 → R8.10.31", () => expect(reiwaDot("2026-10-31")).toBe("R8.10.31"));
});
