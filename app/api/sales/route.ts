import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { addSalesImage, getMySales, listSalesMonth, saveSales, setSalesBoardPublic, setSalesTarget, type SalesValues } from "@/lib/service";

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
  };
  const db = await getDb();
  if (!b.storeId || !b.month) throw new Error("お店と月を指定してください");
  switch (b.action) {
    case "save": return json({ saved: await saveSales(db, userId, b.storeId, b.month, b.rows ?? [], b.source ?? "manual") });
    case "target": await setSalesTarget(db, userId, b.storeId, b.month, b.membershipId ?? null, b.target ?? null); return json({ ok: true });
    case "image": if (!b.image) throw new Error("画像がありません"); return json({ id: await addSalesImage(db, userId, b.storeId, b.month, b.image.mime, Buffer.from(b.image.base64, "base64")) });
    case "board": await setSalesBoardPublic(db, userId, b.storeId, !!b.on); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });
