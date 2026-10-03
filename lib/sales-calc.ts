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
