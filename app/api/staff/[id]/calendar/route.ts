import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setCalendarMember } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as { on?: boolean; stints?: { storeId: string; fromDay: number; toDay: number }[] };
  await setCalendarMember(await getDb(), userId, id, !!b.on, (b.stints ?? []).map((x) => ({ storeId: String(x.storeId), fromDay: Number(x.fromDay), toDay: Number(x.toDay) })));
  return json({ ok: true });
}, { write: true });
