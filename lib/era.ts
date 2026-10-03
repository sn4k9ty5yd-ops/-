// 令和表記。令和元年 = 2019年（R1）。R8年 = 2026年
export function reiwa(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  const ry = y - 2018;
  return ry >= 1 ? `R${ry}年${m}月${d}日` : `${y}年${m}月${d}日`;
}
/** 例: R8年10月16日〜R8年11月15日 */
export const reiwaRange = (start: string, end: string) => `${reiwa(start)}〜${reiwa(end)}`;

/** 棚卸日の書き方。例: R8.10.31 */
export function reiwaDot(date: string): string {
  const ry = Number(date.slice(0, 4)) - 2018;
  return `R${ry}.${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
}
