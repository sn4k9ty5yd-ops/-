import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { importPastStocktake, importPastStocktakeAll, listStocktakeDates, listStocktakes, startStocktake, stocktakeSummary, type ProductKind } from "@/lib/service";

export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const kind = u.searchParams.get("kind"), storeId = u.searchParams.get("storeId");
  if (u.searchParams.get("dates")) return json(await listStocktakeDates(await getDb(), userId));
  const sum = u.searchParams.get("summary");
  if (sum) return json(await stocktakeSummary(await getDb(), userId, sum));
  if ((kind !== "retail" && kind !== "supply") || !storeId) throw new Error("お店と種類を指定してください");
  return json(await listStocktakes(await getDb(), userId, storeId, kind));
});
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; text?: string; storeId?: string; kind?: ProductKind; takenOn?: string };
  if (b.action === "import-all") return json(await importPastStocktakeAll(await getDb(), userId, b.takenOn ?? "", b.text ?? ""));
  if (!b.storeId || (b.kind !== "retail" && b.kind !== "supply")) throw new Error("お店と種類を指定してください");
  if (b.action === "import") return json(await importPastStocktake(await getDb(), userId, b.storeId, b.kind, b.takenOn ?? "", b.text ?? ""));
  return json({ id: await startStocktake(await getDb(), userId, b.storeId, b.kind, b.takenOn ?? "") });
}, { write: true });
