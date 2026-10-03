import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSession } from "./auth/login";
import { getDb } from "./db";
import { applyScheduledRetirements, ForbiddenError, purgeOldMaterialImages, runMorningNotices } from "./service";

export const COOKIE = "session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** ログイン中の人のID（未ログインなら null） */
export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return validateSession(await getDb(), token);
}

/** 「いま開いている」印。30秒に1回だけ書く（画面は30秒ごとに自動更新するので、開いている間は続く） */
async function touchPresence(userId: string) {
  try {
    await applyScheduledRetirements(await getDb());
    await purgeOldMaterialImages(await getDb());
    await runMorningNotices(await getDb());
    await (await getDb()).query(
      "update memberships set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '30 seconds')", [userId]);
  } catch { /* 印がつけられなくても、本来の処理は続ける */ }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** 他サイトからのなりすまし送信(CSRF)対策: 書き込みは JSON 形式のみ受け付ける（SameSite Cookieと併用） */
export function isJson(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").startsWith("application/json");
}

type Ctx<P> = { params: Promise<P> };

export function authed<P = Record<string, never>>(
  fn: (userId: string, req: Request, params: P) => Promise<Response>,
  opts: { write?: boolean } = {},
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    if (opts.write && !isJson(req)) return json({ error: "不正なリクエストです" }, 400);
    const userId = await currentUserId();
    if (!userId) return json({ error: "ログインが必要です" }, 401);
    await touchPresence(userId);
    try {
      return await fn(userId, req, await ctx.params);
    } catch (e) {
      if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
      if (e instanceof Error && e.message) return json({ error: e.message }, 400);
      return json({ error: "エラーが発生しました" }, 500);
    }
  };
}
