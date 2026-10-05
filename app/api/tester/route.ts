import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addTester, cancelStockEntry, listTester } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  return json(await listTester(await getDb(), userId, u.searchParams.get("storeId") ?? "", u.searchParams.get("month") ?? ""));
});
// { action: "add", storeId, productId, qty, day?, note? } / { action: "cancel", id }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; id?: string; storeId?: string; productId?: string; qty?: number; day?: string; note?: string };
  const db = await getDb();
  if (b.action === "cancel") { await cancelStockEntry(db, userId, "tester", String(b.id ?? "")); return json({ ok: true }); }
  return json({ id: await addTester(db, userId, { storeId: String(b.storeId ?? ""), productId: String(b.productId ?? ""), qty: Number(b.qty), day: b.day, note: b.note }) });
}, { write: true });
