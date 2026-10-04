/** レッスンチェック表（採点）の計算。点数は 0〜5（5が最高） */
export const SCORE_CHOICES = [5, 4, 3, 2, 1, 0] as const;
export const SCORE_HINT: Record<number, string> = { 5: "とてもよい", 4: "よい", 3: "ふつう", 2: "もう少し", 1: "できていない", 0: "やっていない" };

export interface CheckSheetLike { maxPoints: number; passPoints: number; maxAttempts: number; items: { id: string; active: boolean }[] }
export interface CheckAttemptLike { attemptNo: number; total: number }

/** 項目の数×5 が、表の満点とちがうとき、知らせる */
export function itemsMax(s: Pick<CheckSheetLike, "items">): number { return s.items.filter((i) => i.active).length * 5; }
export function maxMismatch(s: CheckSheetLike): string | null {
  const m = itemsMax(s);
  return m !== s.maxPoints ? `項目が${s.items.filter((i) => i.active).length}つなので、満点は${m}点になります（いまの設定は${s.maxPoints}点）` : null;
}
export const isPassed = (total: number, passPoints: number) => total >= passPoints;

/** 表の状態: 合格した回（いちばん早い回）、いちばん高い点、採点した回数 */
export function sheetStatus(s: CheckSheetLike, attempts: CheckAttemptLike[]): { passedAt: number | null; best: number | null; count: number } {
  const sorted = [...attempts].sort((a, b) => a.attemptNo - b.attemptNo);
  const p = sorted.find((a) => isPassed(a.total, s.passPoints));
  return { passedAt: p ? p.attemptNo : null, best: sorted.length ? Math.max(...sorted.map((a) => a.total)) : null, count: sorted.length };
}

/** 次に採点する回（まだ採点していない、いちばん若い回）。全部うまっていれば null */
export function nextAttemptNo(s: Pick<CheckSheetLike, "maxAttempts">, attempts: CheckAttemptLike[]): number | null {
  const done = new Set(attempts.map((a) => a.attemptNo));
  for (let n = 1; n <= s.maxAttempts; n++) if (!done.has(n)) return n;
  return null;
}

/** 点数の入力（項目ごと 0〜5）から合計 */
export const totalOfScores = (scores: Record<string, number>, itemIds: string[]) => itemIds.reduce((t, id) => t + (scores[id] ?? 0), 0);
