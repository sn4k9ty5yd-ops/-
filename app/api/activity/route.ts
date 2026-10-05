import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listActivity } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  return json(await listActivity(await getDb(), userId, { userName: u.searchParams.get("person") ?? undefined, area: u.searchParams.get("area") ?? undefined, limit: Number(u.searchParams.get("limit") ?? 200) }));
});
