// 実働・休憩の自動計算。決まり: 実働は最大8時間、在店が8時間を超えた分は休憩（10-19→休憩1:00、10-20→休憩2:00）
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fmt = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

export function calcHours(start: string, end: string): { stay: number; breakMin: number; work: number } {
  const stay = Math.max(0, toMin(end) - toMin(start));
  const work = Math.min(stay, 8 * 60);
  return { stay, breakMin: stay - work, work };
}
