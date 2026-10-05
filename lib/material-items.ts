/** 発注の記録から、「何の商品を何個発注したか」の一覧を作る（月ごと・数か月ぶん）。明細があれば明細、なければ「内容」の文字で数える */
import { itemRows, type ItemRow } from "./material-summary";
import type { MaterialOrder } from "./service";

type Entry = { name: string; qty: number; amount: number; orderId: string; month: string };

function entriesOf(orders: MaterialOrder[]): Entry[] {
  const out: Entry[] = [];
  for (const o of orders) {
    if (o.deleted) continue;
    const month = o.orderedOn.slice(0, 7);
    if ((o.lines ?? []).length > 0) for (const l of o.lines) out.push({ name: l.name.trim() || "（名前なし）", qty: l.qty, amount: l.amount, orderId: o.id, month });
    else out.push({ name: o.item.trim() || `（内容なし・${o.supplier}）`, qty: 1, amount: o.amount, orderId: o.id, month });
  }
  return out;
}

/** 1か月ぶん: 商品ごとの個数・金額（個数の多い順） */
export function monthItems(orders: MaterialOrder[], month: string): ItemRow[] {
  return itemRows(entriesOf(orders).filter((e) => e.month === month)).sort((a, b) => b.qty - a.qty || b.amount - a.amount);
}

/** 数か月ぶん: 商品 × 月の個数の表。合計の個数が多い商品から並べる */
export function itemsByMonthTable(orders: MaterialOrder[], months: string[]): { rows: { name: string; byMonth: number[]; qty: number; amount: number }[]; months: string[] } {
  const m = new Map<string, { name: string; byMonth: number[]; qty: number; amount: number }>();
  for (const e of entriesOf(orders)) {
    const i = months.indexOf(e.month); if (i < 0) continue;
    const r = m.get(e.name) ?? { name: e.name, byMonth: months.map(() => 0), qty: 0, amount: 0 };
    r.byMonth[i] += e.qty; r.qty += e.qty; r.amount += e.amount; m.set(e.name, r);
  }
  return { months, rows: [...m.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount) };
}
