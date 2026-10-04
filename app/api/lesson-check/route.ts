import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { deleteCheckAttempt, getCheckData, saveCheckAttempt, saveCheckSheet } from "@/lib/service";

export const GET = authed(async (userId, req) => json(await getCheckData(await getDb(), userId, new URL(req.url).searchParams.get("trainee") ?? undefined)));

// { action: "attempt", sheetId, traineeId, attemptNo, time, comment, scores } / { action: "delete", attemptId } / { action: "sheet", ...表 }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as Record<string, unknown> & { action?: string };
  const db = await getDb();
  if (b.action === "delete") { await deleteCheckAttempt(db, userId, String(b.attemptId ?? "")); return json({ ok: true }); }
  if (b.action === "sheet") return json({ id: await saveCheckSheet(db, userId, b as never) });
  return json(await saveCheckAttempt(db, userId, b as never));
}, { write: true });
