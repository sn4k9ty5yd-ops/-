import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { deleteStocktake, getStocktake, saveQuantities, setStocktakeStatus, syncStocktakeProducts, type StocktakeStatus } from "@/lib/service";

export const GET = authed<{ id: string }>(async (userId, _req, { id }) => {
  const d = await getStocktake(await getDb(), userId, id);
  return d ? json(d) : json({ error: "棚卸しが見つかりません" }, 404);
});
// { action: "save", entries:[{lineId, quantity}] } / "sync" / "status", status / "delete"
export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as { action?: string; entries?: { lineId: string; quantity: number | null }[]; status?: StocktakeStatus };
  const db = await getDb();
  switch (b.action) {
    case "save": await saveQuantities(db, userId, id, b.entries ?? []); return json({ ok: true });
    case "sync": return json({ added: await syncStocktakeProducts(db, userId, id) });
    case "status":
      if (!b.status || !["open", "submitted", "acknowledged"].includes(b.status)) throw new Error("状態が正しくありません");
      await setStocktakeStatus(db, userId, id, b.status); return json({ ok: true });
    case "delete": await deleteStocktake(db, userId, id); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
