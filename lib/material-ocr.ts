/** 読み取った文字（OCR）から、商品名・数量・金額の行を取り出す。読み間違いは画面で直せる前提のやさしい解析 */
export interface OrderLine { name: string; qty: number; amount: number; /** 読み取った元の文字（直したとき、学習に使う） */ raw?: string }

const zen = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，、](?=\d{3})/g, ",").replace(/[￥¥]/g, "¥").replace(/[×✕ｘx]/g, "×");
const SKIP = /(合計|小計|総計|税込|税抜|消費税|送料|手数料|ポイント|お届け|配送|注文番号|注文日|ご注文|お支払|支払|クーポン|割引|請求|ページ|カート|ログイン|ホーム|TEL|電話|〒)/;

export function parseOrderText(text: string): { lines: OrderLine[]; total: number | null } {
  const lines: OrderLine[] = [];
  let total: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = zen(raw).replace(/\s+/g, " ").trim();
    if (line.length < 2) continue;
    const t = line.match(/(合計|総計|小計)[^\d¥]*¥?\s*([\d,]{3,})/);
    if (t) { const v = Number(t[2].replace(/,/g, "")); if (/合計|総計/.test(t[1]) || total === null) total = v; continue; }
    if (SKIP.test(line)) continue;
    // 末尾の金額（¥1,200 / 1,200円 / 1200）
    const m = line.match(/^(.*?)[\s:：]*¥?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})\s*円?\s*$/);
    if (!m) continue;
    let name = m[1].trim();
    const amount = Number(m[2].replace(/,/g, ""));
    if (!name || amount <= 0) continue;
    // 数量（×3 / 3個 / 3点 / ×3個）
    let qty = 1;
    const q = name.match(/[×]\s*(\d{1,3})\s*[個点本袋箱]?\s*$/) ?? name.match(/(\d{1,3})\s*[個点本袋箱]\s*$/);
    if (q) { qty = Number(q[1]); name = name.slice(0, q.index).trim(); }
    name = name.replace(/^[\-・●○■□▶>\d.)）]+\s*/, "").replace(/[|｜]+$/g, "").trim();
    if (name.length < 2 || /^[\d\s,¥円.]+$/.test(name)) continue;
    lines.push({ name, qty, amount });
  }
  return { lines, total };
}

// ------------------------------------------------------------------ 学習（今までの記録を使って、読み取りを自動で直す）
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s・･\-ー_.,，、。「」()（）\[\]【】]/g, "");
const bigrams = (s: string) => { const a = new Set<string>(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); if (s.length === 1) a.add(s); return a; };
/** 2つの文字のにている度合い（0〜1）。読み間違い（1〜2文字のちがい）に強い */
export function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x), B = bigrams(y);
  let hit = 0; for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

export interface Memory { items: string[]; aliases: { raw: string; name: string }[]; suppliers: string[] }

/** 読み取った商品名を、過去に直した名前・今までの商品名に合わせる（にている度 0.8 以上） */
export function learnName(name: string, mem: Memory): string {
  const key = norm(name);
  const alias = mem.aliases.find((a) => norm(a.raw) === key);
  if (alias) return alias.name;
  if (mem.items.some((n) => norm(n) === key)) return mem.items.find((n) => norm(n) === key)!;
  let best = "", score = 0;
  for (const a of mem.aliases) { const sc = similarity(name, a.raw); if (sc > score) { score = sc; best = a.name; } }
  for (const n of mem.items) { const sc = similarity(name, n); if (sc > score) { score = sc; best = n; } }
  return score >= 0.8 ? best : name;
}

export function applyMemory(lines: OrderLine[], mem: Memory): OrderLine[] {
  return lines.map((l) => { const n = learnName(l.name, mem); return n === l.name ? { ...l, raw: l.raw ?? l.name } : { ...l, name: n, raw: l.raw ?? l.name }; });
}

/** 読み取った文章の中に、知っている発注先の名前があれば、それを返す（長い名前を優先） */
export function findSupplier(text: string, suppliers: string[]): string | null {
  const t = norm(text);
  return [...suppliers].sort((a, b) => b.length - a.length).find((s) => norm(s).length >= 2 && t.includes(norm(s))) ?? null;
}
