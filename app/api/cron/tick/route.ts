import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { runMorningNotices, runSalesReminders } from "@/lib/service";

export const dynamic = "force-dynamic";
// 5分ごとに外から呼ばれる（GitHub Actions）。決めた時刻になったお店にだけ、その日1回、朝の通知を送る。何回呼ばれても二重には送らない
export async function GET() {
  try { const db = await getDb(); return json({ ok: true, ...(await runMorningNotices(db, true)), reminders: await runSalesReminders(db, true) }); }
  catch { return json({ ok: false }, 500); }
}
