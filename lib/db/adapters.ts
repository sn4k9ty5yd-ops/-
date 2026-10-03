import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { Database, Queryable } from "./types";

export function pgDatabase(pool: Pool): Database {
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const out = await fn({ query: (sql, params) => c.query(sql, params as unknown[]) as never });
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

type PgliteLike = Pick<PGlite, "query" | "exec">;

// PGlite は、パラメータ無しなら複数命令をまとめて実行できる exec を使う（pg の simple query と同じ挙動）
const pgliteQuery = (db: PgliteLike): Queryable["query"] => async (sql, params) => {
  if (params && params.length > 0) return (await db.query(sql, params)) as never;
  const results = await db.exec(sql);
  return { rows: results.length ? results[results.length - 1].rows : [] } as never;
};

export function pgliteDatabase(db: PGlite): Database {
  return {
    query: pgliteQuery(db),
    tx: (fn) => db.transaction((t) => fn({ query: pgliteQuery(t as unknown as PgliteLike) })),
    close: () => db.close(),
  };
}
