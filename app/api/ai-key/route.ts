import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { clearAiKey, getAiSettings, setAiKey, setAiTierSetting, testAiKey } from "@/lib/service";

// アプリ制作者だけ。カギそのものは、画面にも返事にも出さない（先頭4文字と最後の4文字だけ）
export const GET = authed(async (userId) => json(await getAiSettings(await getDb(), userId)));

// { action: "save", key } / { action: "clear" } / { action: "test" }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; key?: string; tier?: string };
  const db = await getDb();
  if (b.action === "save") { await setAiKey(db, userId, b.key ?? ""); return json({ ok: true }); }
  if (b.action === "tier") { await setAiTierSetting(db, userId, String(b.tier ?? "")); return json({ ok: true }); }
  if (b.action === "clear") { await clearAiKey(db, userId); return json({ ok: true }); }
  if (b.action === "test") return json(await testAiKey(db, userId));
  throw new Error("操作が正しくありません");
}, { write: true });
