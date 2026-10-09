import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listConflicts, listDayLimits, setDayLimits } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const periodId = u.searchParams.get("periodId"), storeId = u.searchParams.get("storeId");
  if (!periodId || !storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  return json({ limits: await listDayLimits(db, userId, periodId, storeId), conflicts: await listConflicts(db, userId, periodId, storeId) });
});
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { periodId?: string; storeId?: string; days?: string[]; maxOff?: number | null; maxStylist?: number | null; maxAssistant?: number | null };
  if (!b.periodId || !b.storeId) throw new Error("期間とお店を指定してください");
  return json({ count: await setDayLimits(await getDb(), userId, b.periodId, b.storeId, b.days ?? [], b.maxOff ?? null, b.maxStylist != null && b.maxAssistant != null ? { stylist: Number(b.maxStylist), assistant: Number(b.maxAssistant) } : undefined) });
}, { write: true });
