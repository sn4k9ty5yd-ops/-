/** 材料費の統括: 発注の一覧から、月ごと・お店ごと・種類ごと・発注先ごと・商品ごとの合計と割合を出す（家計簿のような見方） */
import type { MaterialKind, SummaryLine, SummaryOrder } from "@/lib/service";

export interface Share { key: string; label: string; amount: number; pct: number; count: number }
export interface MonthRow { month: string; total: number; count: number; change: number | null }   // change=前の月からの増減(%)
export interface ItemRow { name: string; qty: number; amount: number; pct: number; orders: number }
export interface Summary {
  total: number; count: number; avgPerMonth: number;
  months: MonthRow[]; byStore: Share[]; byKind: Share[]; bySupplier: Share[]; byCategory: Share[]; byItem: ItemRow[];
  /** 月ごとの「何を発注したか」（商品名ごとの合計） */
  itemsByMonth: Record<string, ItemRow[]>;
}
const KIND: Record<MaterialKind, string> = { supply: "材料（業務）", retail: "店販", other: "その他" };
const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);

function shares(rows: SummaryOrder[], keyOf: (o: SummaryOrder) => [string, string], total: number): Share[] {
  const m = new Map<string, Share>();
  for (const o of rows) { const [key, label] = keyOf(o); const s = m.get(key) ?? { key, label, amount: 0, pct: 0, count: 0 }; s.amount += o.amount; s.count++; m.set(key, s); }
  return [...m.values()].map((s) => ({ ...s, pct: pct(s.amount, total) })).sort((a, b) => b.amount - a.amount);
}

export function itemRows(entries: { name: string; qty: number; amount: number; orderId: string }[]): ItemRow[] {
  const m = new Map<string, { name: string; qty: number; amount: number; ids: Set<string> }>();
  for (const e of entries) { const r = m.get(e.name) ?? { name: e.name, qty: 0, amount: 0, ids: new Set<string>() }; r.qty += e.qty; r.amount += e.amount; r.ids.add(e.orderId); m.set(e.name, r); }
  const all = [...m.values()]; const t = all.reduce((s, r) => s + r.amount, 0);
  return all.map((r) => ({ name: r.name, qty: r.qty, amount: r.amount, pct: pct(r.amount, t), orders: r.ids.size })).sort((a, b) => b.amount - a.amount);
}

export function summarize(orders: SummaryOrder[], lines: SummaryLine[], storeName: (id: string) => string): Summary {
  const total = orders.reduce((s, o) => s + o.amount, 0);
  const byMonthMap = new Map<string, { total: number; count: number }>();
  for (const o of orders) { const k = o.orderedOn.slice(0, 7); const r = byMonthMap.get(k) ?? { total: 0, count: 0 }; r.total += o.amount; r.count++; byMonthMap.set(k, r); }
  const monthKeys = [...byMonthMap.keys()].sort();
  const months: MonthRow[] = monthKeys.map((k, i) => {
    const r = byMonthMap.get(k)!; const prev = i > 0 ? byMonthMap.get(monthKeys[i - 1])!.total : null;
    return { month: k, total: r.total, count: r.count, change: prev && prev > 0 ? Math.round(((r.total - prev) / prev) * 1000) / 10 : null };
  });
  // 商品ごと: 明細があればその明細、なければ「内容」の文字（それも無ければ「（内容なし）」）
  const withLines = new Set(lines.map((l) => l.orderId));
  const entries = [
    ...lines.map((l) => ({ ...l, month: "" })),
    ...orders.filter((o) => !withLines.has(o.id)).map((o) => ({ orderId: o.id, name: o.item.trim() || `（内容なし・${o.supplier}）`, qty: 1, amount: o.amount, month: "" })),
  ];
  const monthOf = new Map(orders.map((o) => [o.id, o.orderedOn.slice(0, 7)]));
  const itemsByMonth: Record<string, ItemRow[]> = {};
  for (const k of monthKeys) itemsByMonth[k] = itemRows(entries.filter((e) => monthOf.get(e.orderId) === k));
  return {
    total, count: orders.length, avgPerMonth: monthKeys.length ? Math.round(total / monthKeys.length) : 0,
    months, itemsByMonth,
    byStore: shares(orders, (o) => [o.storeId, storeName(o.storeId)], total),
    byKind: shares(orders, (o) => [o.kind, KIND[o.kind]], total),
    bySupplier: shares(orders, (o) => [o.supplier, o.supplier], total),
    byCategory: shares(orders, (o) => [`${o.supplier}｜${o.category}`, o.category ? `${o.supplier}・${o.category}` : `${o.supplier}（カテゴリーなし）`], total),
    byItem: itemRows(entries),
  };
}
