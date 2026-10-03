import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { countMyPushDevices, getPushKey } from "@/lib/service";

// 通知の公開鍵と、この人の登録済み端末の数
export const GET = authed(async (userId) => { const db = await getDb(); return json({ key: await getPushKey(db), devices: await countMyPushDevices(db, userId) }); });
