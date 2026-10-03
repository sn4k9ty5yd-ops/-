import { calcHours, fmt } from "./hours";
import type { ShiftKind, ShiftRow } from "./service";

export const KIND_BUTTONS: { kind: ShiftKind; label: string }[] = [
  { kind: "work", label: "出勤" }, { kind: "off", label: "休み" }, { kind: "paid", label: "有給" }, { kind: "holiday", label: "公休" }, { kind: "other", label: "その他" },
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
export function hoursText(start: string, end: string): string {
  if (!(start && end) || end <= start) return "";
  const h = calcHours(start, end);
  return `在店 ${fmt(h.stay)}　休憩 ${fmt(h.breakMin)}　実働 ${fmt(h.work)}`;
}
export const kindClass = (s?: ShiftRow) => (!s ? "" : s.kind === "work" ? "k-work" : `k-${s.kind}`);
