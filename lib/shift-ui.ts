import { calcHours, DEFAULT_BREAK_RULE, fmt, type BreakRule } from "./hours";
import type { ShiftKind, ShiftRow } from "./service";

export const KIND_BUTTONS: { kind: ShiftKind; label: string }[] = [
  { kind: "work", label: "出勤" }, { kind: "off", label: "休み" }, { kind: "paid", label: "有給" }, { kind: "holiday", label: "公休" },
];
const short = (t: string) => (t.endsWith(":00") ? String(Number(t.slice(0, 2))) : `${Number(t.slice(0, 2))}:${t.slice(3)}`);

/** 表のマスに入れる短い表示 */
export function cellText(s?: ShiftRow): string {
  if (!s) return "";
  if (s.kind === "work") return `${short(s.start!)}-${short(s.end!)}`;
  return { off: "休", paid: "有給", holiday: "公休", other: "他", work: "" }[s.kind];
}
/** やさしい表示（一覧用） */
export function longText(s?: ShiftRow): string {
  if (!s) return "未入力";
  if (s.kind === "work") return s.start && s.end ? `${s.start}〜${s.end}` : "出勤";
  return { off: "休み", paid: "有給", holiday: "公休", other: "その他", work: "" }[s.kind];
}
export function hoursText(start: string, end: string, rule: BreakRule = DEFAULT_BREAK_RULE): string {
  if (!(start && end) || end <= start) return "";
  const h = calcHours(start, end, rule);
  return `在店 ${fmt(h.stay)}　休憩 ${fmt(h.breakMin)}　実働 ${fmt(h.work)}`;
}
export const kindClass = (s?: ShiftRow) => (!s ? "" : s.kind === "work" ? "k-work" : `k-${s.kind}`);

export { sortRoster, ROSTER_FIRST, ROSTER_LAST } from "./labels";
/** 出勤簿の表の「適用」「入店」「退店」「休憩」「実働」の5段 */
export function attendanceLines(s: ShiftRow | undefined, rule: BreakRule = DEFAULT_BREAK_RULE): string[] {
  if (!s) return ["", "", "", "", ""];
  if (s.kind !== "work") return [{ off: "休み", paid: "有給", holiday: "公休", other: "その他", work: "" }[s.kind], "", "", "", ""];
  const h = shiftHours(s, rule);
  return ["出勤", s.start!, s.end!, fmt(h.breakMin), fmt(h.work)];
}

/** 1日の在店・休憩・実働。休憩を手で決めていればそれを使い、なければ会社のルールで自動 */
export function shiftHours(s: { start: string | null; end: string | null; breakMin?: number | null }, rule: BreakRule = DEFAULT_BREAK_RULE) {
  const a = calcHours(s.start!, s.end!, rule);
  if (s.breakMin == null) return a;
  const breakMin = Math.min(a.stay, s.breakMin);
  return { stay: a.stay, breakMin, work: a.stay - breakMin };
}
