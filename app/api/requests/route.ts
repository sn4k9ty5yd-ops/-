import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listRequests, setMyRequest, toggleMyRequest } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const periodId = new URL(req.url).searchParams.get("periodId");
  if (!periodId) throw new Error("期間を指定してください");
  return json(await listRequests(await getDb(), userId, periodId));
});
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { periodId?: string; day?: string; kind?: string | null };
  if (!b.periodId || !b.day || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw new Error("日付が正しくありません");
  if (b.kind !== undefined) {
    if (b.kind !== null && b.kind !== "hope" && b.kind !== "paid") throw new Error("公休か有給を選んでください");
    await setMyRequest(await getDb(), userId, b.periodId, b.day, b.kind);
    return json({ result: b.kind ? "set" : "removed" });
  }
  return json({ result: await toggleMyRequest(await getDb(), userId, b.periodId, b.day) });
}, { write: true });
