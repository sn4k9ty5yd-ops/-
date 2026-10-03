import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { sendTestPush } from "@/lib/service";

export const POST = authed(async (userId) => json({ sent: await sendTestPush(await getDb(), userId) }), { write: true });
