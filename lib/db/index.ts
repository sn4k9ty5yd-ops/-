import { mkdirSync } from "node:fs";
import type { Database } from "./types";

let cached: Promise<Database> | undefined;

/**
 * DATABASE_URL があれば本物のPostgreSQL（Neon等）に、なければ手元のお試し用DB(PGlite)に接続する。
 * お試し用DBは .data/ に保存され、アカウント不要で動作確認できる。
 */
export function getDb(): Promise<Database> {
  cached ??= (async () => {
    const { migrate } = await import("./migrate");
    let db: Database;
    if (process.env.DATABASE_URL) {
      const { Pool } = await import("pg");
      const { pgDatabase } = await import("./adapters");
      db = pgDatabase(new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));
    } else {
      if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL が設定されていません");
      const { PGlite } = await import("@electric-sql/pglite");
      const { pgliteDatabase } = await import("./adapters");
      mkdirSync(".data", { recursive: true });
      db = pgliteDatabase(new PGlite(".data/dev-db"));
    }
    await migrate(db);
    return db;
  })();
  return cached;
}
