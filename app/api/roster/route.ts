import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listRoster } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const storeId = new URL(req.url).searchParams.get("storeId");
  if (!storeId) throw new Error("お店を指定してください");
  return json(await listRoster(await getDb(), userId, storeId));
});
