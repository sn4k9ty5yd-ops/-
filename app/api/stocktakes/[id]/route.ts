import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { copyPreviousStocktake, deleteStocktake, deleteStocktakeLine, editStocktakeLine, getStocktake, saveQuantities, setStocktakeStatus, syncStocktakeProducts, type StocktakeStatus } from "@/lib/service";

export const GET = authed<{ id: string }>(async (userId, _req, { id }) => {
  const d = await getStocktake(await getDb(), userId, id);
  return d ? json(d) : json({ error: "棚卸しが見つかりません" }, 404);
});
// { action: "save", entries:[{lineId, quantity}] } / "sync" / "status", status / "delete"
export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as { action?: string; entries?: { lineId: string; quantity: number | null }[]; status?: StocktakeStatus; onlyEmpty?: boolean; lineId?: string; maker?: string; name?: string; spec?: string; costPrice?: number };
  const db = await getDb();
  switch (b.action) {
    case "save": await saveQuantities(db, userId, id, b.entries ?? []); return json({ ok: true });
    case "sync": return json({ added: await syncStocktakeProducts(db, userId, id) });
    case "status":
      if (!b.status || !["open", "submitted", "acknowledged"].includes(b.status)) throw new Error("状態が正しくありません");
      await setStocktakeStatus(db, userId, id, b.status); return json({ ok: true });
    case "copy-prev": return json(await copyPreviousStocktake(db, userId, id, !!b.onlyEmpty));
    case "edit-line": if (!b.lineId) throw new Error("指定がありません"); await editStocktakeLine(db, userId, b.lineId, { maker: b.maker ?? "", name: b.name ?? "", spec: b.spec ?? "", costPrice: Number(b.costPrice) }); return json({ ok: true });
    case "delete-line": if (!b.lineId) throw new Error("指定がありません"); await deleteStocktakeLine(db, userId, b.lineId); return json({ ok: true });
    case "delete": await deleteStocktake(db, userId, id); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
