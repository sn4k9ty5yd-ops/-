import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { updateStaffProfile } from "@/lib/service";

export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as { name?: string; employeeCode?: string };
  await updateStaffProfile(await getDb(), userId, id, { name: b.name, employeeCode: b.employeeCode });
  return json({ ok: true });
}, { write: true });
