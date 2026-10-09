import { aiStatus } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { deleteCouncil, listCouncils, loadAiKey, runCouncil } from "@/lib/service";

// GET ?storeId=… → そのお店のAI会議の記録 / ?private=1 → 僕専用（アプリ制作者だけ）
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb();
  await loadAiKey(db);
  const priv = u.searchParams.get("private") === "1";
  return json({ items: await listCouncils(db, userId, { storeId: u.searchParams.get("storeId") ?? undefined, private: priv }), aiStatus: aiStatus() });
});

// { action: "run", storeId?, private?, theme, paste? } / { action: "delete", id }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; storeId?: string; private?: boolean; theme?: string; paste?: string; id?: string };
  const db = await getDb();
  if (b.action === "delete") { await deleteCouncil(db, userId, String(b.id ?? "")); return json({ ok: true }); }
  if (b.action === "run") return json(await runCouncil(db, userId, { storeId: b.storeId, private: !!b.private, theme: String(b.theme ?? ""), paste: b.paste }));
  throw new Error("操作が正しくありません");
}, { write: true });
