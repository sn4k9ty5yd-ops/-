import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setAssistantYear } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const { year } = (await req.json()) as { year?: number | null };
  await setAssistantYear(await getDb(), userId, id, year ? Number(year) : null);
  return json({ ok: true });
}, { write: true });
