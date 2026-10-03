import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setOnShift } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { onShift } = (await req.json()) as { onShift?: boolean };
  await setOnShift(await getDb(), userId, id, onShift !== false);
  return json({ ok: true });
}, { write: true });
