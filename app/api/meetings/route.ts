import { aiStatus } from "@/lib/ai";
import { loadAiKey } from "@/lib/service";
import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { createMeeting, deleteMeeting, getMeeting, listMeetings, runMeetingAi, saveMeetingAiResult, updateMeeting, type MeetingAiAction, type MeetingKind } from "@/lib/service";

// GET ?storeId=… → 会議の一覧 / ?id=… → 1つの会議（文字起こし・議事録・要約・マインドマップ・AI会議）
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb();
  await loadAiKey(await getDb());
  const ai = aiStatus();
  const id = u.searchParams.get("id");
  if (id) { const g = await getMeeting(db, userId, id); if (!g) throw new Error("会議が見つかりません"); return json({ meeting: g.meeting, discussions: g.ai, canEdit: g.canEdit, canAgenda: g.canAgenda, aiStatus: ai }); }
  return json({ meetings: await listMeetings(db, userId, u.searchParams.get("storeId") ?? "", (u.searchParams.get("kind") ?? "general") as MeetingKind), aiStatus: ai });
});

// { action: "create", storeId, title, heldOn, attendees } / "update" {id, ...項目} / "delete" {id} / "ai" {id, kind, theme?}
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as Record<string, string | undefined> & { action?: string };
  const db = await getDb();
  switch (b.action) {
    case "create": return json({ id: await createMeeting(db, userId, { storeId: String(b.storeId ?? ""), title: String(b.title ?? ""), heldOn: String(b.heldOn ?? ""), attendees: b.attendees, kind: (b.kind ?? "general") as MeetingKind, agenda: b.agenda }) });
    case "update": { const { action: _a, id, ...patch } = b; await updateMeeting(db, userId, String(id ?? ""), patch); return json({ ok: true }); }
    case "delete": await deleteMeeting(db, userId, String(b.id ?? "")); return json({ ok: true });
    case "ai_paste": await saveMeetingAiResult(db, userId, { id: String(b.id ?? ""), theme: String(b.theme ?? ""), result: String(b.result ?? "") }); return json({ ok: true });
    case "ai": return json(await runMeetingAi(db, userId, { id: String(b.id ?? ""), action: String(b.kind ?? "") as MeetingAiAction, theme: b.theme }));
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
