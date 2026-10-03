import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { Level } from "@/lib/permissions";
import { setStaffLevel } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { level } = (await req.json()) as { level?: number };
  if (![1, 2, 3, 4].includes(level ?? 0)) throw new Error("レベルが正しくありません");
  await setStaffLevel(await getDb(), userId, id, level as Level);
  return json({ ok: true });
}, { write: true });
