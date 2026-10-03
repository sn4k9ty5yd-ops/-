import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { subscribePush, unsubscribePush } from "@/lib/service";

export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string }; off?: boolean };
  const db = await getDb();
  if (b.off) { await unsubscribePush(db, userId, b.endpoint ?? ""); return json({ ok: true }); }
  await subscribePush(db, userId, { endpoint: b.endpoint ?? "", p256dh: b.keys?.p256dh ?? "", auth: b.keys?.auth ?? "" }, req.headers.get("user-agent") ?? "");
  return json({ ok: true });
}, { write: true });
