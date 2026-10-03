import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { disableStaff } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, _req, { id }) => {
  await disableStaff(await getDb(), userId, id);
  return json({ ok: true });
}, { write: true });
