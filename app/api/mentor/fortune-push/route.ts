import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { getFortunePush, setFortunePush } from "@/lib/service";

export const GET = authed(async (userId) => json(await getFortunePush(await getDb(), userId)));
// { month, day, enabled } 誕生日（月日だけ）と、毎朝の占い通知を受け取るか。本人だけが読める（記録にも残さない）
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { month?: number; day?: number; enabled?: boolean };
  await setFortunePush(await getDb(), userId, { month: Number(b.month) || 0, day: Number(b.day) || 0, enabled: !!b.enabled });
  return json({ ok: true });
}, { write: true });
