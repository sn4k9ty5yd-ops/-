// シフト期間（締め日）の計算。startDay=1 → 1日〜末日 / startDay=16 → 16日〜翌15日。
export interface Period {
  start: string; // YYYY-MM-DD
  end: string;
  label: string; // 例: 10/16〜11/15
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function periodFor(date: string, startDay: number): Period {
  const [y, m, d] = date.split("-").map(Number);
  let start: Date, end: Date;
  if (startDay <= 1) {
    start = utc(y, m - 1, 1);
    end = utc(y, m, 0);
  } else if (d >= startDay) {
    start = utc(y, m - 1, startDay);
    end = utc(y, m, startDay - 1);
  } else {
    start = utc(y, m - 2, startDay);
    end = utc(y, m - 1, startDay - 1);
  }
  const f = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
  return { start: iso(start), end: iso(end), label: `${f(start)}〜${f(end)}` };
}

/** date を含む期間から数えて count 件分の期間を返す */
export function upcomingPeriods(date: string, startDay: number, count: number): Period[] {
  const out: Period[] = [];
  let p = periodFor(date, startDay);
  for (let i = 0; i < count; i++) {
    out.push(p);
    const next = new Date(p.end + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    p = periodFor(iso(next), startDay);
  }
  return out;
}

/** 期間の前後移動 */
export const nextPeriod = (p: Period, startDay: number): Period => {
  const d = new Date(p.end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
  return periodFor(iso(d), startDay);
};
export const prevPeriod = (p: Period, startDay: number): Period => {
  const d = new Date(p.start + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  return periodFor(iso(d), startDay);
};

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** 今日の期間から見て、この期間が「今回/前回/次回」か（それ以外は「◯期間前/後」） */
export function relationLabel(periodStart: string, currentStart: string): { label: string; kind: "now" | "prev" | "next" | "other" } {
  const diff = Math.round((monthIndex(periodStart) - monthIndex(currentStart)));
  if (diff === 0) return { label: "今回", kind: "now" };
  if (diff === -1) return { label: "前回", kind: "prev" };
  if (diff === 1) return { label: "次回", kind: "next" };
  return { label: diff < 0 ? `${-diff}期間前` : `${diff}期間後`, kind: "other" };
}

/** 期間ごとの背景色（色相）。隣り合う期間は必ず違う色になる */
const HUES = [205, 150, 40, 330, 265, 15];
export const periodHue = (start: string): number => HUES[monthIndex(start) % HUES.length];
