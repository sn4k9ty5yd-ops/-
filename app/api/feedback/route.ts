import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listFeedback, sendFeedback, updateFeedback } from "@/lib/service";

export const GET = authed(async (userId) => json(await listFeedback(await getDb(), userId)));
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { body?: string; id?: string; status?: "new" | "read" | "done"; reply?: string };
  const db = await getDb();
  if (b.id) await updateFeedback(db, userId, b.id, { status: b.status, reply: b.reply });
  else await sendFeedback(db, userId, b.body ?? "");
  return json({ ok: true });
}, { write: true });
