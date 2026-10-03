import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listManualPages } from "@/lib/service";

export const GET = authed(async (userId, req) => json(await listManualPages(await getDb(), userId, new URL(req.url).searchParams.get("q") ?? undefined)));
