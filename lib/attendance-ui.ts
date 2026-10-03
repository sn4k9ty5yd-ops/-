import { fmt } from "./hours";
import type { AttendanceRow } from "./service";

export const minText = (m: number) => fmt(m);
export const attKindText = (r?: AttendanceRow) => (!r ? "" : { work: "出勤", off: "休み", paid: "有休", holiday: "公休", other: "他" }[r.kind]);
export const attDetail = (r?: AttendanceRow) =>
  !r ? "未入力" : r.kind === "work" ? `${r.clockIn}〜${r.clockOut}　休憩${fmt(r.breakMin)}　実働${fmt(r.workMin)}` : { off: "休み", paid: "有給", holiday: "公休", other: "その他", work: "" }[r.kind];

export interface Totals { workMin: number; workDays: number; paid: number; off: number; holiday: number; }
export function totalsOf(rows: AttendanceRow[], membershipId: string): Totals {
  const t: Totals = { workMin: 0, workDays: 0, paid: 0, off: 0, holiday: 0 };
  for (const r of rows) {
    if (r.membershipId !== membershipId) continue;
    if (r.kind === "work") { t.workMin += r.workMin; t.workDays++; } else if (r.kind === "paid") t.paid++; else if (r.kind === "holiday") t.holiday++; else t.off++;
  }
  return t;
}
