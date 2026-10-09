import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import {
  clearAttendance, confirmAttendanceDay, draftAttendanceFromShifts, getAttendanceDayConfirm, fillAttendance, listAttendance, listAttendanceRoster, saveAttendance, setAttendanceStatus,
  type AttendanceEntry, type AttendanceStatus,
} from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  const periodId = u.searchParams.get("periodId"), storeId = u.searchParams.get("storeId");
  const cd = u.searchParams.get("confirmDay");
  if (cd && storeId) return json(await getAttendanceDayConfirm(await getDb(), userId, storeId, cd));
  if (!periodId || !storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  const a = await listAttendance(db, userId, periodId, storeId);
  return json({ ...a, roster: await listAttendanceRoster(db, userId, periodId, storeId) });
});

// { action: "save"|"clear"|"draft"|"fill"|"status", periodId, storeId, ... }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as {
    action?: string; periodId?: string; storeId?: string; entries?: AttendanceEntry[]; items?: { membershipId: string; day: string }[];
    overwrite?: boolean; day?: string; days?: string[]; membershipIds?: string[]; clockIn?: string; clockOut?: string; status?: AttendanceStatus;
  };
  if (!b.periodId || !b.storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  switch (b.action) {
    case "day-confirm": await confirmAttendanceDay(db, userId, b.storeId, b.day ?? ""); return json({ ok: true });
    case "save": return json({ count: await saveAttendance(db, userId, b.periodId, b.storeId, b.entries ?? []) });
    case "clear": return json({ count: await clearAttendance(db, userId, b.periodId, b.storeId, b.items ?? []) });
    case "draft": return json({ count: await draftAttendanceFromShifts(db, userId, b.periodId, b.storeId, !!b.overwrite) });
    case "fill": return json(await fillAttendance(db, userId, { periodId: b.periodId, storeId: b.storeId, days: b.days ?? [], membershipIds: b.membershipIds, clockIn: b.clockIn ?? "", clockOut: b.clockOut ?? "", overwrite: b.overwrite }));
    case "status":
      if (!b.status || !["open", "submitted", "acknowledged"].includes(b.status)) throw new Error("状態が正しくありません");
      await setAttendanceStatus(db, userId, b.periodId, b.storeId, b.status);
      return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
