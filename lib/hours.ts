// 実働・休憩の自動計算。ルールは会社の設定（オフィスが変更できる）。
// 初期値: 実働の上限8時間、段階なし。在店が上限を超えた分は休憩（10-19→休憩1:00、10-20→休憩2:00）。8時間以内は休憩なし。
export interface BreakRule {
  capMinutes: number | null;                              // 実働の上限（null=上限なし）
  tiers: { overMinutes: number; breakMinutes: number }[]; // 在店が overMinutes を超えたら休憩を最低 breakMinutes にする
}
export const DEFAULT_BREAK_RULE: BreakRule = { capMinutes: 480, tiers: [] };

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fmt = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

export function calcHours(start: string, end: string, rule: BreakRule = DEFAULT_BREAK_RULE): { stay: number; breakMin: number; work: number } {
  const stay = Math.max(0, toMin(end) - toMin(start));
  const fixed = Math.max(0, ...rule.tiers.filter((t) => stay > t.overMinutes).map((t) => t.breakMinutes));
  const overCap = rule.capMinutes ? Math.max(0, stay - rule.capMinutes) : 0;
  const breakMin = Math.min(stay, Math.max(fixed, overCap));
  return { stay, breakMin, work: stay - breakMin };
}

/** 設定値の検査（画面・API・DB保存前に使う）。問題があれば日本語のメッセージを返す */
export function validateBreakRule(r: BreakRule): string | null {
  if (r.capMinutes !== null && !(Number.isInteger(r.capMinutes) && r.capMinutes >= 60 && r.capMinutes <= 1440)) return "実働の上限は1〜24時間の間で入れてください";
  if (r.tiers.length > 10) return "段階は10個までです";
  const seen = new Set<number>();
  for (const t of r.tiers) {
    if (!Number.isInteger(t.overMinutes) || t.overMinutes < 0 || t.overMinutes > 1440) return "「何時間を超えたら」は0〜24時間の間で入れてください";
    if (!Number.isInteger(t.breakMinutes) || t.breakMinutes < 0 || t.breakMinutes > 480) return "休憩は0〜8時間の間で入れてください";
    if (seen.has(t.overMinutes)) return "同じ時間の段階が2つあります";
    seen.add(t.overMinutes);
  }
  return null;
}
