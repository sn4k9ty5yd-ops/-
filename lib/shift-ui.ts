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
  if (s.kind === "work") return `${s.start}〜${s.end}`;
  return { off: "休み", paid: "有給", holiday: "公休", other: "その他", work: "" }[s.kind];
}
export function hoursText(start: string, end: string, rule: BreakRule = DEFAULT_BREAK_RULE): string {
  if (!(start && end) || end <= start) return "";
  const h = calcHours(start, end, rule);
  return `在店 ${fmt(h.stay)}　休憩 ${fmt(h.breakMin)}　実働 ${fmt(h.work)}`;
}
export const kindClass = (s?: ShiftRow) => (!s ? "" : s.kind === "work" ? "k-work" : `k-${s.kind}`);

/** 出勤簿の名前の並び順（オフィスが決めた順。名前がこの文字で始まる人を先に。ほかの人はそのあと） */
export const ROSTER_FIRST: string[][] = [["永尾"], ["中嶋"], ["成田"], ["金子直"], ["松村"], ["廣"], ["金子た", "金子崇"], ["大田"], ["上田"], ["渡邊", "渡辺"], ["山田"]];
export const ROSTER_LAST = ["大坪"];   // いちばん最後
export function sortRoster<T extends { name: string }>(list: T[]): T[] {
  const rank = (n: string) => { const t = n.replace(/\s|　/g, ""); const i = ROSTER_FIRST.findIndex((ps) => ps.some((p) => t.startsWith(p))); if (ROSTER_LAST.some((p) => t.startsWith(p))) return 1000; return i < 0 ? ROSTER_FIRST.length : i; };
  return [...list].sort((a, b) => rank(a.name) - rank(b.name));
}
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
