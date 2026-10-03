"use client";
import { reiwaRange } from "./era";
import { nextPeriod, periodFor, periodHue, prevPeriod, relationLabel, type Period } from "./periods";

/** 日本時間の今日（YYYY-MM-DD） */
export const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export const tintStyle = (start: string) => ({ ["--h" as string]: periodHue(start) }) as React.CSSProperties;

/** 期間の見出し＋前後に動かす矢印＋「今回/前回/次回」の印 */
export function PeriodNav({ period, startDay, onChange }: { period: Period; startDay: number; onChange(p: Period): void }) {
  const cur = periodFor(todayJst(), startDay);
  const rel = relationLabel(period.start, cur.start);
  return (
    <div className="pnav tint" style={tintStyle(period.start)}>
      <button aria-label="前の期間" onClick={() => onChange(prevPeriod(period, startDay))}>‹</button>
      <div>
        <span className={`badge2 ${rel.kind}`}>{rel.label}</span>
        <div className="plabel">{period.label}</div>
        <div className="sub">{reiwaRange(period.start, period.end)}</div>
      </div>
      <button aria-label="次の期間" onClick={() => onChange(nextPeriod(period, startDay))}>›</button>
    </div>
  );
}
export { periodFor };
