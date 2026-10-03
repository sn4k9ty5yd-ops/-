import { getDb } from "@/lib/db";
import { currentUserId } from "@/lib/http";
import { getManualAsset } from "@/lib/service";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new Response("ログインが必要です", { status: 401 });
  const a = await getManualAsset(await getDb(), userId, (await ctx.params).id);
  if (!a) return new Response("見つかりません", { status: 404 });
  const safe = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(a.mime) ? a.mime : "application/octet-stream";
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": safe,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name || "file")}`,
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
