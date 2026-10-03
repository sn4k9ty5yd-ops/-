import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addStore, listStores } from "@/lib/service";

export const GET = authed(async (userId) => json(await listStores(await getDb(), userId)));
export const POST = authed(async (userId, req) => {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) throw new Error("お店の名前を入力してください");
  await addStore(await getDb(), userId, name);
  return json({ ok: true });
}, { write: true });
