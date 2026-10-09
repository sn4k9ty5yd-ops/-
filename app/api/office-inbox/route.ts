import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listOfficeInbox, markOfficeInboxDone } from "@/lib/service";

export const GET = authed(async (userId) => json(await listOfficeInbox(await getDb(), userId)));
export const POST = authed(async (userId, req) => {
  const b = (await req.json().catch(() => ({}))) as { ids?: number[] };
  await markOfficeInboxDone(await getDb(), userId, Array.isArray(b.ids) ? b.ids.filter((x) => Number.isInteger(x)) : undefined);
  return json({ ok: true });
}, { write: true });
