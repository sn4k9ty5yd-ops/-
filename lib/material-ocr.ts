/** 読み取った文字（OCR）から、商品名・数量・金額の行を取り出す。読み間違いは画面で直せる前提のやさしい解析 */
export interface OrderLine { name: string; qty: number; amount: number }

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
