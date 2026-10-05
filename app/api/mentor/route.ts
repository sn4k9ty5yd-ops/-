import { aiStatus } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { deleteMentorSession, getMentor, listMbtiDirectory, sendMentorMessage, setMentorMbti } from "@/lib/service";

// GET ?session=… → 自分の会話だけ（ほかの人の会話は、DBが見せない）
export const GET = authed(async (userId, req) => {
  const s = new URL(req.url).searchParams.get("session") ?? undefined;
  if (new URL(req.url).searchParams.get("directory")) return json(await listMbtiDirectory(await getDb(), userId));   // スタイリストだけ
  return json({ ...(await getMentor(await getDb(), userId, s)), aiAvailable: aiStatus().available });
});
// { action: "mbti", mbti } / "send" {sessionId, text} / "delete" {sessionId}
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; mbti?: string | null; sessionId?: string; text?: string };
  const db = await getDb();
  if (b.action === "mbti") { await setMentorMbti(db, userId, b.mbti || null); return json({ ok: true }); }
  if (b.action === "delete") { await deleteMentorSession(db, userId, String(b.sessionId ?? "")); return json({ ok: true }); }
  return json(await sendMentorMessage(db, userId, { sessionId: String(b.sessionId ?? ""), text: String(b.text ?? "") }));
}, { write: true });
