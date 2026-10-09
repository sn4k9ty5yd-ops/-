import { getViewAs } from "./db/view-as";
import { AiHttpError } from "./ai";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSession } from "./auth/login";
import { getDb } from "./db";
import { applyScheduledRetirements, ForbiddenError, logActivity, purgeOldMaterialImages, runMorningNotices, runSalesReminders } from "./service";

export const COOKIE = "session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 14;

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
    await runSalesReminders(await getDb());
    await (await getDb()).query(
      "update memberships set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '30 seconds')", [userId]);
  } catch { /* 印がつけられなくても、本来の処理は続ける */ }
}

/** 返事は、ほかの人や中間のサーバーに保存されないようにする（個人の情報が入っているため） */
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

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
    // 発行されたままのパスコードの人は、先にパスコードを変えるまで、ほかの機能は使えない
    const path = new URL(req.url).pathname;
    if (!["/api/me", "/api/security", "/api/logout"].includes(path)) {
      const mc = (await (await getDb()).query<{ m: boolean }>("select passcode_must_change as m from memberships where id = $1", [userId])).rows[0]?.m;
      if (mc) return json({ error: "先に、パスコードを変えてください（「セキュリティ」の画面）" }, 403);
    }
    // 社長のアカウント（レベル4）は、見るだけ。書き込みの操作は止める（パスコード・通知・ご要望は除く）
    if (opts.write && !["/api/security", "/api/notifications", "/api/office-inbox", "/api/push/subscribe", "/api/push/test", "/api/feedback", "/api/mentor/fortune"].includes(path)) {
      const ro = getViewAs(userId)?.execView ?? (await (await getDb()).query<{ x: boolean }>("select exec_view as x from memberships where id = $1", [userId])).rows[0]?.x;
      if (ro) return json({ error: "この操作は、できません（権限がありません）" }, 403);
    }
    const cloned = opts.write && Number(req.headers.get("content-length") ?? 0) < 200000 ? req.clone() : null;   // 記録のために、中身のうち action・status・storeId だけを見る
    try {
      const res = await fn(userId, req, await ctx.params);
      if (cloned && res.ok) {
        // 変更の記録（失敗しても、本来の処理には影響させない）
        const b = (await cloned.json().catch(() => null)) as Record<string, unknown> | null;
        await logActivity(await getDb(), userId, path, b && typeof b === "object" ? { action: b.action, status: b.status, storeId: b.storeId } : null).catch(() => undefined);
      }
      return res;
    } catch (e) {
      if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
      if (e instanceof AiHttpError && e.detail) {
        // AIの会社からのエラーは、アプリ制作者にだけ、くわしい原因も見せる（原因をつかむため。カギは含まれない）
        const owner = (await (await getDb()).query<{ x: boolean }>("select app_owner as x from memberships where id = $1", [userId]).catch(() => ({ rows: [] as { x: boolean }[] }))).rows[0]?.x;
        return json({ error: e.message + (owner ? `\n（くわしい原因：${e.detail}）` : "") }, 400);
      }
      if (e instanceof Error && e.message) return json({ error: e.message }, 400);
      return json({ error: "エラーが発生しました" }, 500);
    }
  };
}
