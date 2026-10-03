import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addLeaveGrant, getMyLeave, listLeave, listLeaveHistory } from "@/lib/service";

// GET ?storeId=… → そのお店の残り日数（権限がある人） / GET ?me=1 → 自分の残り / GET ?history=<人のID> → 付与・調整の履歴
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb();
  if (u.searchParams.get("me")) return json(await getMyLeave(db, userId));
  const h = u.searchParams.get("history");
  if (h) return json(await listLeaveHistory(db, userId, h));
  const storeId = u.searchParams.get("storeId");
  if (!storeId) throw new Error("お店を指定してください");
  return json(await listLeave(db, userId, storeId));
});
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { membershipId?: string; days?: number; note?: string; grantedOn?: string };
  if (!b.membershipId || typeof b.days !== "number") throw new Error("人と日数を指定してください");
  await addLeaveGrant(await getDb(), userId, { membershipId: b.membershipId, days: b.days, note: b.note, grantedOn: b.grantedOn });
  return json({ ok: true });
}, { write: true });
