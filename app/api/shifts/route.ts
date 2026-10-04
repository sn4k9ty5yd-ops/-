import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { applyRequests, autoDraftShifts, canEditShifts, clearShifts, fillDefault, listShifts, saveShifts, type ShiftEntry } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  const periodId = u.searchParams.get("periodId"), storeId = u.searchParams.get("storeId");
  if (!periodId || !storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  return json({ shifts: await listShifts(db, userId, periodId, storeId), editable: await canEditShifts(db, userId, periodId, storeId) });
});

// { action: "save", entries } / "clear", items } / "fill", days, membershipIds?, start, end, overwrite? } / "applyRequests" }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as {
    action?: string; periodId?: string; storeId?: string; entries?: ShiftEntry[]; items?: { membershipId: string; day: string }[];
    days?: string[]; membershipIds?: string[]; start?: string; end?: string; overwrite?: boolean; keepOff?: boolean;
  };
  if (!b.periodId || !b.storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  if (b.action === "save") return json({ count: await saveShifts(db, userId, b.periodId, b.storeId, b.entries ?? []) });
  if (b.action === "clear") return json({ count: await clearShifts(db, userId, b.periodId, b.storeId, b.items ?? []) });
  if (b.action === "autoDraft") return json({ count: await autoDraftShifts(db, userId, b.periodId, b.storeId) });
  if (b.action === "applyRequests") return json({ count: await applyRequests(db, userId, b.periodId, b.storeId) });
  if (b.action === "fill")
    return json({ count: await fillDefault(db, userId, { periodId: b.periodId, storeId: b.storeId, days: b.days ?? [], membershipIds: b.membershipIds, start: b.start ?? "", end: b.end ?? "", overwrite: b.overwrite, keepOff: b.keepOff }) });
  throw new Error("操作が正しくありません");
}, { write: true });
