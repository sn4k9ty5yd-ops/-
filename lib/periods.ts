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
