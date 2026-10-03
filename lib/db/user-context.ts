import type { Database, Queryable } from "./types";

/**
 * ログイン中の人として実行する。
 * アプリ用ロール(app_user)に切り替え、「いま操作している人」をDBに伝える。
 * これにより Row Level Security（会社ごとの分離・レベルごとの権限）がDB側で必ず効く。
 */
export function asUser<T>(db: Database, userId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return db.tx(async (q) => {
    await q.query("set local role app_user");
    await q.query("select set_config('app.user_id', $1, true)", [userId]);
    return fn(q);
  });
}
