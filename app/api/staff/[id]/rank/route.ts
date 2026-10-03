import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setRank } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { rank } = (await req.json()) as { rank?: string | null };
  await setRank(await getDb(), userId, id, rank || null);
  return json({ ok: true });
}, { write: true });
