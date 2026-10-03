import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { getMe } from "@/lib/service";

export const GET = authed(async (userId) => json(await getMe(await getDb(), userId)));
