import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { BreakRule } from "@/lib/hours";
import { getMe, setBreakRule } from "@/lib/service";

export const GET = authed(async (userId) => json({ breakRule: (await getMe(await getDb(), userId))?.breakRule }));
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { breakRule?: BreakRule };
  if (!b.breakRule) throw new Error("設定がありません");
  await setBreakRule(await getDb(), userId, b.breakRule);
  return json({ ok: true });
}, { write: true });
