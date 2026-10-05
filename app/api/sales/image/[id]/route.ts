import { getDb } from "@/lib/db";
import { currentUserId } from "@/lib/http";
import { getSalesImage } from "@/lib/service";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new Response("ログインが必要です", { status: 401 });
  const a = await getSalesImage(await getDb(), userId, (await ctx.params).id);
  if (!a) return new Response("見つかりません", { status: 404 });
  return new Response(new Uint8Array(a.data), { headers: { "Content-Type": a.mime, "Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" } });
}
