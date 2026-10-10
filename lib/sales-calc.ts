/** 売上の計算（客単価・新規の割合・達成率・前年比・お店の中の割合） */
export const unitPrice = (total: number, customers: number) => (customers > 0 ? Math.round(total / customers) : null);
export const pct1 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
export const newRate = (newC: number, repeatC: number) => pct1(newC, newC + repeatC);
export const repeatRate = (newC: number, repeatC: number) => pct1(repeatC, newC + repeatC);
/** 目標に対する達成率（%） */
export const achievement = (total: number, target: number | null) => (target && target > 0 ? pct1(total, target) : null);
/** 前年同月との比べ（%）。前年が0やデータなしなら null。+は前年より上 */
export const yoy = (cur: number, prev: number | null | undefined) => (prev && prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
export const signed = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

/** ヘッドスパは、1人につき 1,000円 を売上から引いた金額に、歩合がつく（例: 1,800円×2人＋4,500円×3人＝17,100円・5人 → 17,100−5,000＝12,100円の20%）。事務所への報告も、引いたあとの金額 */
export const SPA_DEDUCT_PER_PERSON = 1000;
export const spaNet = (sales: number, count: number) => Math.max(0, sales - SPA_DEDUCT_PER_PERSON * Math.max(0, count));
export interface CommissionInput { retail: number; kitsukeSales: number; makeupSales: number; spaSales: number; spaCount?: number }
export interface CommissionRates { retail: number; kitsuke: number; makeup: number; spa: number }
export const COMMISSION_LABELS = { retail: "店販", kitsuke: "着付け", makeup: "メイク", spa: "ヘッドスパ" } as const;
/** 歩合の目安（売上 × 割合。1項目ごとに、円未満は切り捨て） */
export function calcCommission(v: CommissionInput, rates: CommissionRates): { items: { key: keyof CommissionRates; label: string; sales: number; rate: number; amount: number; note?: string }[]; total: number } {
  const src = { retail: v.retail, kitsuke: v.kitsukeSales, makeup: v.makeupSales, spa: spaNet(v.spaSales, v.spaCount ?? 0) };
  const items = (Object.keys(src) as (keyof CommissionRates)[]).map((key) => ({
    key, label: COMMISSION_LABELS[key], sales: src[key], rate: rates[key], amount: Math.floor((src[key] * rates[key]) / 100),
    ...(key === "spa" && (v.spaCount ?? 0) > 0 ? { note: `売上 ${v.spaSales.toLocaleString("ja-JP")}円 − ${SPA_DEDUCT_PER_PERSON.toLocaleString("ja-JP")}円×${v.spaCount}人` } : {}),
  }));
  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
}
