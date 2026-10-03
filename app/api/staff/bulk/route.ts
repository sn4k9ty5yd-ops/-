import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { Level } from "@/lib/permissions";
import { addStaffBulk } from "@/lib/service";

// { rows: [{ name, employeeCode, storeId, level }], dryRun?: boolean }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { rows?: { name: string; employeeCode: string; storeId: string; level: number }[]; dryRun?: boolean };
  const rows = (b.rows ?? []).map((r) => ({ name: String(r.name ?? ""), employeeCode: String(r.employeeCode ?? ""), storeId: String(r.storeId ?? ""), level: Number(r.level) as Level }));
  return json(await addStaffBulk(await getDb(), userId, rows, !!b.dryRun));
}, { write: true });
