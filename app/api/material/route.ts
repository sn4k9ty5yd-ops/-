import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import {
  addMaterialImage, getMaterialMemory, addMaterialOrder, listMaterialImages, cancelMaterialOrder, getMaterialBudget, listMaterialLog, listMaterialOrders, listMaterialSuppliers,
  setMaterialBudget, updateMaterialOrder, type MaterialInput,
} from "@/lib/service";

// GET ?storeId=…&from=…&to=…[&month=YYYY-MM-01] → { orders, suppliers, budget }  /  &log=1 → 変更の記録
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const storeId = u.searchParams.get("storeId");
  if (!storeId) throw new Error("お店を指定してください");
  const db = await getDb();
  if (u.searchParams.get("memory")) return json(await getMaterialMemory(db, userId, storeId));
  if (u.searchParams.get("log")) return json(await listMaterialLog(db, userId, storeId));
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "", month = u.searchParams.get("month");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("期間が正しくありません");
  const [orders, suppliers, budget, images] = await Promise.all([
    listMaterialOrders(db, userId, storeId, from, to), listMaterialSuppliers(db, userId, storeId), month ? getMaterialBudget(db, userId, storeId, month) : Promise.resolve(null), listMaterialImages(db, userId, storeId, from, to),
  ]);
  return json({ orders, suppliers, budget, images });
});

// { action: "add"|"update"|"cancel"|"budget", storeId?, id?, input?, month?, amount? }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; storeId?: string; id?: string; input?: MaterialInput; month?: string; amount?: number | null; image?: { mime: string; base64: string } };
  const db = await getDb();
  switch (b.action) {
    case "add": if (!b.storeId || !b.input) throw new Error("入力がありません"); return json({ id: await addMaterialOrder(db, userId, b.storeId, b.input) });
    case "update": if (!b.id || !b.input) throw new Error("入力がありません"); await updateMaterialOrder(db, userId, b.id, b.input); return json({ ok: true });
    case "cancel": if (!b.id) throw new Error("指定がありません"); await cancelMaterialOrder(db, userId, b.id); return json({ ok: true });
    case "image": if (!b.id || !b.image) throw new Error("画像がありません"); return json({ id: await addMaterialImage(db, userId, b.id, b.image.mime, Buffer.from(b.image.base64, "base64")) });
    case "budget": if (!b.storeId || !b.month) throw new Error("指定がありません"); await setMaterialBudget(db, userId, b.storeId, b.month, b.amount ?? null); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
