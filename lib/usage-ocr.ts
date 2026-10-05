/** 写真（メモ・画面）の文字から、「どの店販商品を何本、業務に回したか」を取り出す。読み間違いは、画面で直せる前提 */
import { similarity } from "./material-ocr";

export interface UsageProduct { id: string; maker: string; name: string; spec: string }
export interface UsageCandidate { raw: string; productId: string | null; qty: number; score: number }

const zen = (s: string) => s.normalize("NFKC").replace(/[×✕ｘ]/g, "×");
const norm = (s: string) => zen(s).toLowerCase().replace(/[\s・･\-ー_.,，、。「」()（）\[\]【】:：]/g, "");

/** 1行から、数量（×3・3本・3個・3点・3コ、または行の終わりの1〜3けたの数字）を取り出す。見つからなければ1 */
export function readQty(line: string): { qty: number; rest: string } {
  const t = zen(line).trim();
  let m = t.match(/[×x]\s*(\d{1,3})\s*(?:本|個|コ|ケ|点|袋|箱)?\s*$/i) ?? t.match(/(\d{1,3})\s*(?:本|個|コ|ケ|点|袋|箱)\s*$/) ?? t.match(/\s(\d{1,3})\s*$/);
  if (!m) return { qty: 1, rest: t };
  const qty = Number(m[1]);
  return { qty: qty >= 1 && qty <= 999 ? qty : 1, rest: t.slice(0, m.index).trim() };
}

/** 文字の行ごとに、いちばんにている商品をえらぶ（0.5未満は「見つからない」＝商品は空） */
export function parseUsageText(text: string, products: UsageProduct[]): UsageCandidate[] {
  const out: UsageCandidate[] = [];
  const keys = products.map((p) => ({ p, full: norm(`${p.maker}${p.name}${p.spec}`), nm: norm(p.name), mk: norm(p.maker) }));
  for (const raw of text.split(/\r?\n/)) {
    const line = zen(raw).replace(/\s+/g, " ").trim();
    if (line.length < 2 || /^[\d\s,¥円.:：\-/]+$/.test(line)) continue;
    if (/(合計|小計|総計|税込|税抜|消費税|送料|日付|ページ)/.test(line)) continue;
    const { qty, rest } = readQty(line);
    const key = norm(rest);
    if (key.length < 2) continue;
    let best: { id: string; score: number } | null = null;
    for (const k of keys) {
      let s = Math.max(similarity(rest, k.p.name), similarity(rest, `${k.p.maker}${k.p.name}`), similarity(rest, `${k.p.maker}${k.p.name}${k.p.spec}`));
      if (k.nm.length >= 3 && key.includes(k.nm)) s = Math.max(s, 0.95);          // 品名が、そのまま入っている
      else if (k.full.length >= 4 && key.includes(k.full)) s = Math.max(s, 1);
      if (!best || s > best.score) best = { id: k.p.id, score: s };
    }
    out.push({ raw: line, productId: best && best.score >= 0.5 ? best.id : null, qty, score: best?.score ?? 0 });
  }
  return out;
}
