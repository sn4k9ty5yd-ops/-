import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { reissuePasscode } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, _req, { id }) =>
  json({ passcode: await reissuePasscode(await getDb(), userId, id) }), { write: true });
