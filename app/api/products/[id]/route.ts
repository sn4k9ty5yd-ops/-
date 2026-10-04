import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setProductStatus, setProductStores, setProductStoreUse, updateProduct } from "@/lib/service";

// { name, maker, spec, costPrice, status?, storeIds? } ／ { storeId, on }（このお店で使う・使わない）／ { status }（全体から消す・再開）
export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as { maker?: string; name?: string; spec?: string; costPrice?: number; status?: "active" | "discontinued"; storeIds?: string[]; storeId?: string; on?: boolean };
  const db = await getDb();
  if (b.storeId !== undefined) { await setProductStoreUse(db, userId, id, b.storeId, !!b.on); return json({ ok: true }); }
  if (b.status && b.name === undefined) { await setProductStatus(db, userId, id, b.status); return json({ ok: true }); }
  if (b.name !== undefined) await updateProduct(db, userId, id, { maker: b.maker, name: b.name, spec: b.spec, costPrice: Number(b.costPrice), status: b.status });
  if (b.storeIds) await setProductStores(db, userId, id, b.storeIds);
  return json({ ok: true });
}, { write: true });
