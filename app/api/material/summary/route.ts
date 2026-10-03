import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { materialSummaryData } from "@/lib/service";

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → { orders, lines }（管理者・材料担当のみ）
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("期間が正しくありません");
  return json(await materialSummaryData(await getDb(), userId, from, to));
});
