import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { createInterview, listInterviewMentees, listInterviews, reviewInterview, saveInterview, submitInterview } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const db = await getDb();
  if (new URL(req.url).searchParams.get("mentees")) return json(await listInterviewMentees(db, userId));
  return json(await listInterviews(db, userId));
});
// { action: "create", menteeId, template, heldOn } / "save" {id, answers, memo, heldOn} / "submit" {id} / "review" {id, comment}
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; id?: string; menteeId?: string; template?: string; heldOn?: string; answers?: Record<string, string>; memo?: string; comment?: string };
  const db = await getDb();
  switch (b.action) {
    case "create": return json({ id: await createInterview(db, userId, { menteeId: String(b.menteeId ?? ""), template: String(b.template ?? ""), heldOn: String(b.heldOn ?? "") }) });
    case "save": await saveInterview(db, userId, String(b.id ?? ""), { answers: b.answers, memo: b.memo, heldOn: b.heldOn }); return json({ ok: true });
    case "submit": return json(await submitInterview(db, userId, String(b.id ?? "")));
    case "review": await reviewInterview(db, userId, String(b.id ?? ""), b.comment ?? ""); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
