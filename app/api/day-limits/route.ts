import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { getOffDefault, listConflicts, listDayLimits, setDayLimits, setOffDefault } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const periodId = u.searchParams.get("periodId"), storeId = u.searchParams.get("storeId");
  if (!periodId || !storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  return json({ offDefault: await getOffDefault(db, userId, storeId), limits: await listDayLimits(db, userId, periodId, storeId), conflicts: await listConflicts(db, userId, periodId, storeId) });
});
export const POST = authed(async (userId, req) => {
  const raw = (await req.clone().json()) as { action?: string; storeId?: string; stylist?: number; assistant?: number; assistant1?: number | null; assistant2?: number | null };
  if (raw.action === "default") { await setOffDefault(await getDb(), userId, String(raw.storeId ?? ""), { stylist: Number(raw.stylist), assistant: Number(raw.assistant), assistant1: raw.assistant1 ?? null, assistant2: raw.assistant2 ?? null }); return json({ ok: true }); }
  const b = (await req.json()) as { periodId?: string; storeId?: string; days?: string[]; maxOff?: number | null; maxStylist?: number | null; maxAssistant?: number | null; maxAssistant1?: number | null; maxAssistant2?: number | null };
  if (!b.periodId || !b.storeId) throw new Error("期間とお店を指定してください");
  return json({ count: await setDayLimits(await getDb(), userId, b.periodId, b.storeId, b.days ?? [], b.maxOff ?? null, b.maxStylist != null && b.maxAssistant1 != null && b.maxAssistant2 != null ? { stylist: Number(b.maxStylist), assistant: 0, assistant1: Number(b.maxAssistant1), assistant2: Number(b.maxAssistant2) } : b.maxStylist != null && b.maxAssistant != null ? { stylist: Number(b.maxStylist), assistant: Number(b.maxAssistant) } : undefined) });
}, { write: true });
