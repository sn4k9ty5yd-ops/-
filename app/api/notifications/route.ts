import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listNotifications, markNotificationsRead } from "@/lib/service";

export const GET = authed(async (userId) => json(await listNotifications(await getDb(), userId)));
export const POST = authed(async (userId, req) => {
  const b = (await req.json().catch(() => ({}))) as { ids?: string[] };
  await markNotificationsRead(await getDb(), userId, b.ids);
  return json({ ok: true });
}, { write: true });
