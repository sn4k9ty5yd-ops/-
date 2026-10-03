import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { getNoticeSettings, setNoticeSetting } from "@/lib/service";

export const GET = authed(async (userId) => json(await getNoticeSettings(await getDb(), userId)));
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { storeId?: string; enabled?: boolean; time?: string };
  if (!b.storeId) throw new Error("お店を指定してください");
  await setNoticeSetting(await getDb(), userId, b.storeId, !!b.enabled, b.time ?? "");
  return json({ ok: true });
}, { write: true });
