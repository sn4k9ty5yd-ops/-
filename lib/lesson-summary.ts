/** レッスン記録の集計（カテゴリごとの回数・かかった時間の平均・最近の変化） */
import type { LessonRow } from "@/lib/service";

export interface CatStat { category: string; total: number; month: number; avgMin: number | null; recentAvg: number | null; lastOrdinal: number }
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** rows: 1人ぶんの記録（全期間でも月でもよい）。month=YYYY-MM でその月の回数を数える */
export function statsFor(rows: LessonRow[], month: string): CatStat[] {
  const by = new Map<string, LessonRow[]>();
  for (const r of rows) by.set(r.category, [...(by.get(r.category) ?? []), r]);
  return [...by.entries()].map(([category, list]) => {
    const sorted = [...list].sort((a, b) => (a.day === b.day ? a.createdAt.localeCompare(b.createdAt) : a.day.localeCompare(b.day)));
    const mins = sorted.map((r) => r.minutes).filter((m): m is number => m !== null);
    return {
      category, total: sorted.length, month: sorted.filter((r) => r.day.startsWith(month)).length,
      avgMin: avg(mins), recentAvg: avg(mins.slice(-5)), lastOrdinal: Math.max(...sorted.map((r) => r.ordinal)),
    };
  }).sort((a, b) => b.total - a.total);
}

/** 最近5回の平均が、全体の平均より 10%以上長い／短いか */
export function trend(s: CatStat): "slower" | "faster" | "same" | null {
  if (s.avgMin === null || s.recentAvg === null || s.total < 6) return null;
  if (s.recentAvg > s.avgMin * 1.1) return "slower";
  if (s.recentAvg < s.avgMin * 0.9) return "faster";
  return "same";
}
