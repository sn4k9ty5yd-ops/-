import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addStore, listStores, moveStore, renameStore, setStoreHours, setStoreStatus } from "@/lib/service";

export const GET = authed(async (userId) => json(await listStores(await getDb(), userId)));

// { action: "add"|"rename"|"close"|"reopen"|"up"|"down", storeId?, name? }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; storeId?: string; name?: string; open?: string; close?: string; satOpen?: string; satClose?: string };
  const db = await getDb();
  const action = b.action ?? "add";
  if (action === "add") await addStore(db, userId, b.name ?? "");
  else {
    if (!b.storeId) throw new Error("お店を指定してください");
    if (action === "rename") await renameStore(db, userId, b.storeId, b.name ?? "");
    else if (action === "hours") await setStoreHours(db, userId, b.storeId, b.open ?? "", b.close ?? "", b.satOpen && b.satClose ? { open: b.satOpen, close: b.satClose } : null);
    else if (action === "close") await setStoreStatus(db, userId, b.storeId, "closed");
    else if (action === "reopen") await setStoreStatus(db, userId, b.storeId, "active");
    else if (action === "up" || action === "down") await moveStore(db, userId, b.storeId, action);
    else throw new Error("操作が正しくありません");
  }
  return json({ ok: true });
}, { write: true });
