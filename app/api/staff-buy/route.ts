import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addPurchase, cancelStockEntry, listPurchases } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  return json(await listPurchases(await getDb(), userId, u.searchParams.get("storeId") ?? "", u.searchParams.get("month") ?? ""));
});
// { action: "add", membershipId, productId, qty, day?, note? } / { action: "cancel", id }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; id?: string; membershipId?: string; productId?: string; qty?: number; day?: string; note?: string };
  const db = await getDb();
  if (b.action === "cancel") { await cancelStockEntry(db, userId, "purchase", String(b.id ?? "")); return json({ ok: true }); }
  return json({ id: await addPurchase(db, userId, { membershipId: String(b.membershipId ?? ""), productId: String(b.productId ?? ""), qty: Number(b.qty), day: b.day, note: b.note }) });
}, { write: true });
