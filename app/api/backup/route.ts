import { NextResponse } from "next/server";
import { exportAll } from "@/lib/backup";
import { getDb } from "@/lib/db";
import { currentUserId, isJson, json } from "@/lib/http";
import { getMe } from "@/lib/service";

// 管理者（レベル4）だけ。書き込みと同じ守り（JSON形式のPOSTのみ）
export async function POST(req: Request) {
  if (!isJson(req)) return json({ error: "不正なリクエストです" }, 400);
  const userId = await currentUserId();
  if (!userId) return json({ error: "ログインが必要です" }, 401);
  const db = await getDb();
  const me = await getMe(db, userId);
  if (!me || me.level !== 4) return json({ error: "この操作をする権限がありません" }, 403);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(await exportAll(db), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="album-backup-${today}.json"`, "cache-control": "no-store" },
  });
}
