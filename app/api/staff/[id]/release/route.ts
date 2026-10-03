import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { releaseRetiredCode } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, _req, { id }) => {
  return json({ releasedCode: await releaseRetiredCode(await getDb(), userId, id) });
}, { write: true });
