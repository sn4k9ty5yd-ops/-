import type { Database, Queryable } from "./types";
import { getViewAs } from "./view-as";

/**
 * ログイン中の人として実行する。
 * アプリ用ロール(app_user)に切り替え、「いま操作している人」をDBに伝える。
 * これにより Row Level Security（会社ごとの分離・レベルごとの権限）がDB側で必ず効く。
 */
export function asUser<T>(db: Database, userId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return db.tx(async (q) => {
    await q.query("set local role app_user");
    await q.query("select set_config('app.user_id', $1, true)", [userId]);
    const v = getViewAs(userId);   // アプリ制作者が「見え方」を切りかえているとき（DB側でも、本人がアプリ制作者のときだけ効く）
    if (v) await q.query("select set_config('app.view_level', $1, true), set_config('app.view_rank', $2, true), set_config('app.view_display', $3, true), set_config('app.view_exec', $4, true)", [String(v.level), v.rank ?? "", String(v.displayOnly), String(v.execView)]);
    return fn(q);
  });
}
