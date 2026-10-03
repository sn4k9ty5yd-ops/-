import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setProductStores, updateProduct } from "@/lib/service";

// { name, maker, spec, costPrice, status?, storeIds? }
export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as { maker?: string; name?: string; spec?: string; costPrice?: number; status?: "active" | "discontinued"; storeIds?: string[] };
  const db = await getDb();
  if (b.name !== undefined) await updateProduct(db, userId, id, { maker: b.maker, name: b.name, spec: b.spec, costPrice: Number(b.costPrice), status: b.status });
  if (b.storeIds) await setProductStores(db, userId, id, b.storeIds);
  return json({ ok: true });
}, { write: true });
