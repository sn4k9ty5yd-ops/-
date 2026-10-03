/** 日本の祝日（国民の祝日）。年ごとに計算する（春分・秋分・ハッピーマンデー・振替休日・国民の休日を含む）。対象は2000年以降 */
const cache = new Map<number, Map<string, string>>();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dowOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
/** m月の第n月曜日の日付 */
const nthMonday = (y: number, m: number, n: number) => 1 + ((8 - dowOf(y, m, 1)) % 7) + (n - 1) * 7;
const addDays = (s: string, n: number) => { const t = new Date(s + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

function build(y: number): Map<string, string> {
  const h = new Map<string, string>();
  const set = (m: number, d: number, name: string) => h.set(iso(y, m, d), name);
  const k = y - 1980, adj = Math.floor(k / 4);
  set(1, 1, "元日");
  set(1, nthMonday(y, 1, 2), "成人の日");
  set(2, 11, "建国記念の日");
  if (y >= 2020) set(2, 23, "天皇誕生日"); else if (y >= 1989 && y <= 2018) set(12, 23, "天皇誕生日");
  set(3, Math.floor(20.8431 + 0.242194 * k - adj), "春分の日");
  set(4, 29, "昭和の日");
  set(5, 3, "憲法記念日"); set(5, 4, "みどりの日"); set(5, 5, "こどもの日");
  if (y === 2020) { set(7, 23, "海の日"); set(7, 24, "スポーツの日"); set(8, 10, "山の日"); }
  else if (y === 2021) { set(7, 22, "海の日"); set(7, 23, "スポーツの日"); set(8, 8, "山の日"); }
  else { set(7, nthMonday(y, 7, 3), "海の日"); if (y >= 2016) set(8, 11, "山の日"); set(10, nthMonday(y, 10, 2), "スポーツの日"); }
  set(9, nthMonday(y, 9, 3), "敬老の日");
  set(9, Math.floor(23.2488 + 0.242194 * k - adj), "秋分の日");
  set(11, 3, "文化の日"); set(11, 23, "勤労感謝の日");
  // 国民の休日（祝日にはさまれた平日）
  for (const d of [...h.keys()]) {
    const mid = addDays(d, 1);
    if (!h.has(mid) && h.has(addDays(d, 2)) && new Date(mid + "T00:00:00Z").getUTCDay() !== 0) h.set(mid, "国民の休日");
  }
  // 振替休日（日曜が祝日なら、次の祝日でない日）
  for (const d of [...h.keys()].sort()) {
    if (new Date(d + "T00:00:00Z").getUTCDay() !== 0) continue;
    let n = addDays(d, 1);
    while (h.has(n)) n = addDays(n, 1);
    h.set(n, "振替休日");
  }
  return h;
}

/** その日が祝日なら、祝日の名前（なければ null） */
export function holidayName(day: string): string | null {
  const y = Number(day.slice(0, 4));
  if (!(y >= 2000 && y <= 2099)) return null;
  let m = cache.get(y);
  if (!m) { m = build(y); cache.set(y, m); }
  return m.get(day) ?? null;
}
