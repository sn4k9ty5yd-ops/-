import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { RegisterRow } from "@/lib/register-sales";
import { confirmRegisterSales, getRegisterSales, saveRegisterSales } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  const storeId = u.searchParams.get("storeId"), month = u.searchParams.get("month");
  if (!storeId || !month) throw new Error("お店と月を指定してください");
  return json(await getRegisterSales(await getDb(), userId, storeId, month));
});

// { action: "save", storeId, month, days, rows } / { action: "confirm", storeId, month, on }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; storeId?: string; month?: string; days?: number; rows?: RegisterRow[]; on?: boolean };
  if (!b.storeId || !b.month) throw new Error("お店と月を指定してください");
  const db = await getDb();
  if (b.action === "confirm") await confirmRegisterSales(db, userId, b.storeId, b.month, !!b.on);
  else await saveRegisterSales(db, userId, b.storeId, b.month, Number(b.days ?? 0), b.rows ?? []);
  return json({ ok: true });
}, { write: true });
