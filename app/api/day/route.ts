import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { getDayInfo, notifyConflicts, postDayMessage } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const periodId = u.searchParams.get("periodId"), storeId = u.searchParams.get("storeId"), day = u.searchParams.get("day");
  if (!periodId || !storeId || !day) throw new Error("期間・お店・日付を指定してください");
  return json(await getDayInfo(await getDb(), userId, periodId, storeId, day));
});
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; periodId?: string; storeId?: string; day?: string; body?: string };
  if (!b.periodId || !b.storeId) throw new Error("期間とお店を指定してください");
  const db = await getDb();
  if (b.action === "notify") return json(await notifyConflicts(db, userId, b.periodId, b.storeId, b.day));
  if (!b.day) throw new Error("日付を指定してください");
  await postDayMessage(db, userId, b.periodId, b.storeId, b.day, b.body ?? "");
  return json({ ok: true });
}, { write: true });
