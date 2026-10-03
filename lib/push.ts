/** スマホへの通知（Web Push）。無料。鍵はDBに自動で作って保存する（サーバーの設定は要らない） */
import webpush from "web-push";
import type { Database } from "@/lib/db/types";

export interface PushPayload { title: string; body: string; url?: string; tag?: string }
let cached: { pub: string; priv: string } | null = null;

export async function vapidKeys(db: Database): Promise<{ pub: string; priv: string }> {
  if (cached) return cached;
  let r = (await db.query<{ public_key: string; private_key: string }>("select public_key, private_key from push_config where id = 1")).rows[0];
  if (!r) {
    const k = webpush.generateVAPIDKeys();
    await db.query("insert into push_config (id, public_key, private_key) values (1, $1, $2) on conflict (id) do nothing", [k.publicKey, k.privateKey]);
    r = (await db.query<{ public_key: string; private_key: string }>("select public_key, private_key from push_config where id = 1")).rows[0];
  }
  cached = { pub: r.public_key, priv: r.private_key };
  return cached;
}

/** 指定した人たちの、登録済みの端末すべてに送る。使えなくなった端末は自動で消す。送れた件数を返す */
export async function pushToUsers(db: Database, userIds: string[], p: PushPayload): Promise<number> {
  if (userIds.length === 0) return 0;
  const k = await vapidKeys(db);
  const subs = (await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    "select id, endpoint, p256dh, auth from push_subscriptions where membership_id = any($1::uuid[])", [userIds])).rows;
  let ok = 0;
  const body = JSON.stringify({ title: p.title, body: p.body.slice(0, 300), url: p.url ?? "/home", tag: p.tag });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
        { vapidDetails: { subject: "mailto:noreply@album-system.onrender.com", publicKey: k.pub, privateKey: k.priv }, TTL: 60 * 60 * 12 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.query("delete from push_subscriptions where id = $1", [s.id]).catch(() => {});
    }
  }));
  return ok;
}
