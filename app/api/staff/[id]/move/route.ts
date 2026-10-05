import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { moveStaff } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { storeId } = (await req.json()) as { storeId?: string };
  await moveStaff(await getDb(), userId, id, String(storeId ?? ""));
  return json({ ok: true });
}, { write: true });
