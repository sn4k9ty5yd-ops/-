import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listRequests, toggleMyRequest } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const periodId = new URL(req.url).searchParams.get("periodId");
  if (!periodId) throw new Error("期間を指定してください");
  return json(await listRequests(await getDb(), userId, periodId));
});
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { periodId?: string; day?: string };
  if (!b.periodId || !b.day || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw new Error("日付が正しくありません");
  return json({ result: await toggleMyRequest(await getDb(), userId, b.periodId, b.day) });
}, { write: true });
