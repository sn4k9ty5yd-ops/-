import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { deleteEmptyManualPages, listManualCleanup, listManualExternal, listManualPages } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("cleanup")) return json(await listManualCleanup(await getDb(), userId));
  if (u.searchParams.get("external")) return json(await listManualExternal(await getDb(), userId));
  return json(await listManualPages(await getDb(), userId, u.searchParams.get("q") ?? undefined));
});

// { action: "deleteEmpty", ids } 空のページの整理（正美さん以上）。調べ直して、本当に空のものだけ消す
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; ids?: string[] };
  if (b.action !== "deleteEmpty") throw new Error("操作が正しくありません");
  return json(await deleteEmptyManualPages(await getDb(), userId, Array.isArray(b.ids) ? b.ids.slice(0, 200) : []));
}, { write: true });
