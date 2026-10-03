import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setRetireDate } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { date } = (await req.json()) as { date?: string | null };
  await setRetireDate(await getDb(), userId, id, date ?? null);
  return json({ ok: true });
}, { write: true });
