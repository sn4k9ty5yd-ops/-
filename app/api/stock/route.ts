import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { applyStocktakeToStock, listMovements, listStock, recordMovements, recountStock, setStockLimits, setStockSettings, type StockSettings } from "@/lib/service";

// GET ?storeId=… → { settings, items } / &history=1[&productId=…] → 履歴 / &low=1 → 少ない商品の数
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const storeId = u.searchParams.get("storeId");
  if (!storeId) throw new Error("お店を指定してください");
  const db = await getDb();
  if (u.searchParams.get("history")) return json(await listMovements(db, userId, storeId, u.searchParams.get("productId") ?? undefined, Number(u.searchParams.get("limit") ?? 100)));
  const s = await listStock(db, userId, storeId);
  if (u.searchParams.get("low")) return json({ count: s.items.filter((i) => i.low).length });
  return json(s);
});

// { action: "move"|"recount"|"limits"|"settings"|"apply", storeId, ... }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as {
    action?: string; storeId?: string; items?: { productId: string; kind: "in" | "out"; qty: number; note?: string }[];
    entries?: { productId: string; counted: number }[]; productId?: string; min?: number | null; target?: number | null;
    settings?: StockSettings; stocktakeId?: string;
  };
  const db = await getDb();
  if (b.action === "apply") { if (!b.stocktakeId) throw new Error("棚卸しを指定してください"); return json({ count: await applyStocktakeToStock(db, userId, b.stocktakeId) }); }
  if (!b.storeId) throw new Error("お店を指定してください");
  switch (b.action) {
    case "move": await recordMovements(db, userId, b.storeId, b.items ?? []); return json({ ok: true });
    case "recount": return json({ changed: await recountStock(db, userId, b.storeId, b.entries ?? []) });
    case "limits": if (!b.productId) throw new Error("商品を指定してください"); await setStockLimits(db, userId, b.storeId, b.productId, b.min ?? null, b.target ?? null); return json({ ok: true });
    case "settings": if (!b.settings) throw new Error("設定がありません"); await setStockSettings(db, userId, b.storeId, b.settings); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
