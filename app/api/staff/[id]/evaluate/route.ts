import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setCanEvaluate } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { on } = (await req.json()) as { on?: boolean };
  await setCanEvaluate(await getDb(), userId, id, !!on);
  return json({ ok: true });
}, { write: true });
