import { similarity } from "./material-ocr";

export interface ProductCandidate { maker: string; name: string; spec: string; costPrice: number }

const SPEC = /^\d+(?:\.\d+)?\s*(?:ml|mL|ML|ｍｌ|g|ｇ|kg|L|l|個|本|枚|入|cc)$/;
const PRICE = /^[¥￥]?\d{1,3}(?:[,，]\d{3})+円?$|^[¥￥]?\d{3,7}円?$/;

/** 写真の文字を読んだもの（複数行）から、商品の候補を作る。1行＝1商品。見まちがいは、あとで画面で直す */
export function parseProductOcr(text: string): ProductCandidate[] {
  const out: ProductCandidate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[|｜_\[\]{}<>「」]/g, " ").replace(/\s+/g, " ").trim();
    if (line.length < 2) continue;
    if (!/[぀-ヿ㐀-鿿A-Za-z]{2,}/.test(line)) continue;           // 文字が2つ以上ない行は、とばす
    const tokens = line.split(" ");
    let cost = 0;
    const last = tokens[tokens.length - 1];
    if (PRICE.test(last)) { cost = Number(last.replace(/[¥￥,，円]/g, "")); tokens.pop(); }
    const si = tokens.findIndex((t, i) => i > 0 && SPEC.test(t));
    const spec = si >= 0 ? tokens.splice(si, 1)[0] : "";
    let maker = "", name = tokens.join(" ");
    if (tokens.length >= 2) { maker = tokens[0]; name = tokens.slice(1).join(" "); }
    if (!name) continue;
    out.push({ maker, name, spec, costPrice: cost });
  }
  return out;
}

/** すでにある商品に、にているか（同じ商品を二重に登録しないための目印） */
export function findSimilarProduct(c: ProductCandidate, existing: { maker: string; name: string; spec: string }[], threshold = 0.85): { maker: string; name: string; spec: string } | null {
  const key = (x: { maker: string; name: string; spec: string }) => `${x.maker}${x.name}${x.spec}`.replace(/\s/g, "").toLowerCase();
  const k = key(c);
  let best: { p: { maker: string; name: string; spec: string }; s: number } | null = null;
  for (const e of existing) { const s = similarity(k, key(e)); if (s >= threshold && (!best || s > best.s)) best = { p: e, s }; }
  return best?.p ?? null;
}
