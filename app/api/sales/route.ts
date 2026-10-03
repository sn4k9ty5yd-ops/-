import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addSalesImage, getMySales, listSalesMonth, reviewSales, saveMySales, saveSales, setSalesBoardPublic, setSalesTarget, submitMySales, type SalesValues } from "@/lib/service";

// GET ?storeId=…&month=YYYY-MM（店長・管理者の入力画面）／ ?mine=1&month=YYYY-MM（自分の売上）
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb(); const month = u.searchParams.get("month") ?? "";
  if (u.searchParams.get("mine")) return json(await getMySales(db, userId, month));
  const storeId = u.searchParams.get("storeId"); if (!storeId) throw new Error("お店を指定してください");
  return json(await listSalesMonth(db, userId, storeId, month));
});

export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as {
    action?: string; storeId?: string; month?: string; rows?: { membershipId: string; values: SalesValues }[]; source?: "manual" | "photo" | "import";
    membershipId?: string | null; target?: number | null; on?: boolean; image?: { mime: string; base64: string };
    values?: SalesValues; review?: "manager_ok" | "office_ok" | "return"; comment?: string; members?: string[];
  };
  const db = await getDb();
  if (b.action === "save-own") { if (!b.month || !b.values) throw new Error("入力がありません"); await saveMySales(db, userId, b.month, b.values); return json({ ok: true }); }
  if (b.action === "submit") { if (!b.month) throw new Error("月を指定してください"); return json({ status: await submitMySales(db, userId, b.month) }); }
  if (b.action === "review") {
    if (!b.month || !b.review) throw new Error("指定がありません");
    const out: string[] = [];
    for (const id of b.members ?? (b.membershipId ? [b.membershipId] : [])) out.push(await reviewSales(db, userId, id, b.month, b.review, b.comment ?? ""));
    return json({ statuses: out });
  }
  if (!b.storeId || !b.month) throw new Error("お店と月を指定してください");
  switch (b.action) {
    case "save": return json({ saved: await saveSales(db, userId, b.storeId, b.month, b.rows ?? [], b.source ?? "manual") });
    case "target": await setSalesTarget(db, userId, b.storeId, b.month, b.membershipId ?? null, b.target ?? null); return json({ ok: true });
    case "image": if (!b.image) throw new Error("画像がありません"); return json({ id: await addSalesImage(db, userId, b.storeId, b.month, b.image.mime, Buffer.from(b.image.base64, "base64")) });
    case "board": await setSalesBoardPublic(db, userId, b.storeId, !!b.on); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
