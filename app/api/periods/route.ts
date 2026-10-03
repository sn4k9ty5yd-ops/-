import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { createNextPeriod, listPeriods, setPeriodStatus, type PeriodStatus } from "@/lib/service";

export const GET = authed(async (userId) => json(await listPeriods(await getDb(), userId)));

// 作成: { action: "create" } / 進行・受付日時の変更: { periodId, storeId, status?, openAt?, closeAt? }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; periodId?: string; storeId?: string; status?: PeriodStatus; openAt?: string | null; closeAt?: string | null };
  const db = await getDb();
  if (b.action === "create") {
    await createNextPeriod(db, userId, new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)); // 日本時間の今日
    return json({ ok: true });
  }
  if (!b.periodId || !b.storeId) throw new Error("期間とお店を指定してください");
  await setPeriodStatus(db, userId, { periodId: b.periodId, storeId: b.storeId, status: b.status, openAt: b.openAt, closeAt: b.closeAt });
  return json({ ok: true });
}, { write: true });
