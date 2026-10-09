import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listManualExternal, listManualPages } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("external")) return json(await listManualExternal(await getDb(), userId));
  return json(await listManualPages(await getDb(), userId, u.searchParams.get("q") ?? undefined));
});
