import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { listNames } from "@/lib/service";

export const GET = authed(async (userId) => json(await listNames(await getDb(), userId)));
