import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { exportRecords } from "@/lib/service";

// { from, to, sections: string[], detail?: boolean } → 書面にする全情報（管理者のみ）
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { from?: string; to?: string; sections?: string[]; detail?: boolean; staffIds?: string[]; ranges?: Record<string, { from?: string; to?: string }> };
  return json(await exportRecords(await getDb(), userId, { from: b.from ?? "", to: b.to ?? "", sections: b.sections ?? [], detail: !!b.detail, staffIds: b.staffIds ?? [], ranges: b.ranges ?? {} }));
}, { write: true });
