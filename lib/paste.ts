import type { ProductInput } from "./service";

const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
/** 「¥1,200」「1200円」「１，２００」などを整数にする。数字として読めなければ null */
export function parsePrice(raw: string): number | null {
  const t = toHalf(raw).replace(/[¥￥円,，\s]/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

export interface PasteResult { items: ProductInput[]; badLines: { line: number; text: string; reason: string }[]; skippedHeader: boolean; }

/**
 * Excel などからコピーした表（タブ区切り。カンマ区切りも可）を商品に変換する。
 * 列の順番は「メーカー・品名・規格・仕入値」。3列なら「品名・規格・仕入値」、2列なら「品名・仕入値」。
 * 最初の行が見出し（仕入値が数字でない）なら飛ばす。
 */
export function parseProductPaste(text: string): PasteResult {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  const items: ProductInput[] = []; const badLines: PasteResult["badLines"] = []; let skippedHeader = false;
  lines.forEach((line, i) => {
    const cols = (line.includes("\t") ? line.split("\t") : line.split(/[,，]/)).map((c) => c.trim());
    const last = cols[cols.length - 1];
    const price = parsePrice(last ?? "");
    if (price === null) {
      if (i === 0) { skippedHeader = true; return; }
      badLines.push({ line: i + 1, text: line, reason: "仕入値が数字ではありません" }); return;
    }
    let maker = "", name = "", spec = "";
    if (cols.length >= 4) [maker, name, spec] = cols; else if (cols.length === 3) [name, spec] = cols; else if (cols.length === 2) [name] = cols;
    if (!name) { badLines.push({ line: i + 1, text: line, reason: "品名がありません" }); return; }
    items.push({ maker, name, spec, costPrice: price });
  });
  return { items, badLines, skippedHeader };
}
