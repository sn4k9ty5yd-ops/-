import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import {
  cancelLeaveChange, decideLeaveChange, getMyLeavePlan, leaveOverview, listLeaveReview, listLeaveWindows, openLeaveWindow,
  requestLeaveChange, setLeaveWindowStatus, setMyLeaveDays, submitMyLeave,
} from "@/lib/service";

// GET ?windows=1 / ?window=ID（自分の分）/ ?review=1（店長・事務員さん）/ ?overview=ID（提出状況）
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb();
  if (u.searchParams.get("windows")) return json(await listLeaveWindows(db, userId));
  if (u.searchParams.get("review")) return json(await listLeaveReview(db, userId));
  const ov = u.searchParams.get("overview"); if (ov) return json(await leaveOverview(db, userId, ov));
  const w = u.searchParams.get("window"); if (w) return json(await getMyLeavePlan(db, userId, w));
  throw new Error("指定がありません");
});

export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as {
    action?: string; id?: string; windowId?: string; days?: string[]; on?: boolean; from?: string | null; to?: string | null; reason?: string;
    approve?: boolean; comment?: string; label?: string; start?: string; end?: string; status?: "open" | "closed";
  };
  const db = await getDb();
  switch (b.action) {
    case "open-window": return json({ id: await openLeaveWindow(db, userId, { label: b.label ?? "", start: b.start ?? "", end: b.end ?? "" }) });
    case "window-status": if (!b.id || !b.status) throw new Error("指定がありません"); await setLeaveWindowStatus(db, userId, b.id, b.status); return json({ ok: true });
    case "set-days": if (!b.windowId) throw new Error("指定がありません"); await setMyLeaveDays(db, userId, b.windowId, b.days ?? []); return json({ ok: true });
    case "submit": if (!b.windowId) throw new Error("指定がありません"); await submitMyLeave(db, userId, b.windowId, b.on !== false); return json({ ok: true });
    case "request": if (!b.windowId) throw new Error("指定がありません"); return json({ id: await requestLeaveChange(db, userId, b.windowId, b.from ?? null, b.to ?? null, b.reason ?? "") });
    case "decide": if (!b.id) throw new Error("指定がありません"); return json({ status: await decideLeaveChange(db, userId, b.id, !!b.approve, b.comment ?? "") });
    case "cancel": if (!b.id) throw new Error("指定がありません"); await cancelLeaveChange(db, userId, b.id); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
