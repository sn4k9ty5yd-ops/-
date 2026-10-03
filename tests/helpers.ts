import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { pgDatabase, pgliteDatabase } from "../lib/db/adapters";
import type { Database } from "../lib/db/types";

/**
 * テスト用のデータベース。普段は手元用の簡易版(PGlite)。
 * 環境変数 TEST_DATABASE_URL があれば、本物のPostgreSQL（Neonと同じ種類）で、毎回まっさらにして実行する。
 * 本物のときは、テストファイルを1つずつ順番に動かす: vitest run --fileParallelism=false
 */
export async function newDb(): Promise<Database> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return pgliteDatabase(new PGlite());
  const db = pgDatabase(new Pool({ connectionString: url, max: 4 }));
  await db.query("drop schema if exists app cascade; drop schema if exists public cascade; create schema public;");
  return db;
}
