import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addCommuteRosterBulk, checkCommute, matchCommuteNames, getCommute, getCommuteImage, getCommuteSummary, setCommuteDue, setCommuteRoster, submitCommute } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb();
  if (u.searchParams.get("summary")) return json(await getCommuteSummary(db, userId));
  const img = u.searchParams.get("image");
  if (img) return json({ image: await getCommuteImage(db, userId, img) });
  return json(await getCommute(db, userId, u.searchParams.get("month") ?? undefined, u.searchParams.get("storeId") ?? undefined));
});

// { action: "submit", month, image } / "roster" {memberId,on} / "check" {id,status,note} / "due" {day}
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as Record<string, unknown>; const db = await getDb();
  switch (b.action) {
    case "submit": await submitCommute(db, userId, String(b.month ?? ""), String(b.image ?? "")); break;
    case "roster": await setCommuteRoster(db, userId, String(b.memberId ?? ""), !!b.on); break;
    case "check": await checkCommute(db, userId, String(b.id ?? ""), b.status === "redo" ? "redo" : "checked", String(b.note ?? "")); break;
    case "match": return json({ matches: await matchCommuteNames(db, userId, String(b.text ?? "")) });
    case "roster-bulk": return json({ count: await addCommuteRosterBulk(db, userId, Array.isArray(b.ids) ? b.ids.map(String) : []) });
    case "due": await setCommuteDue(db, userId, Number(b.day)); break;
    default: throw new Error("操作が正しくありません");
  }
  return json({ ok: true });
}, { write: true });
