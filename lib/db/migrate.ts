import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./types";

/** db/migrations の *.sql を番号順に、まだ実行していないものだけ実行する */
export async function migrate(db: Database, dir = "db/migrations"): Promise<string[]> {
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.tx(async (q) => {
      await q.query(readFileSync(join(dir, f), "utf8"));
      await q.query("insert into schema_migrations (name) values ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}
