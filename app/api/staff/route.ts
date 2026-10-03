import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { Level } from "@/lib/permissions";
import { addStaff, listStaff } from "@/lib/service";

export const GET = authed(async (userId) => json(await listStaff(await getDb(), userId)));
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { name?: string; employeeCode?: string; storeId?: string; level?: number };
  if (!b.name?.trim() || !b.employeeCode?.trim() || !b.storeId) throw new Error("名前・社員番号・お店を入力してください");
  if (![1, 2, 3, 4].includes(b.level ?? 1)) throw new Error("レベルが正しくありません");
  return json(await addStaff(await getDb(), userId, { name: b.name, employeeCode: b.employeeCode, storeId: b.storeId, level: (b.level ?? 1) as Level }));
}, { write: true });
