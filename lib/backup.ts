import type { Database } from "./db/types";

/** バックアップに入れない項目（パスコードのハッシュ・ログイン状態・ロック情報）。流出しても悪用されないようにする */
// メンターの会話・面談シートは、読める人が決まっている（バックアップでも、ほかの人が読めないように入れない）
const SKIP_TABLES = new Set(["sessions", "schema_migrations", "mentor_messages", "mentor_profiles", "interviews", "app_secrets"]);
const SKIP_COLUMNS = new Set(["passcode_hash", "failed_attempts", "locked_until"]);

/** すべての業務データ（シフト・出勤簿・有給・商品・棚卸し・在庫など）を、1つのJSONにまとめる */
export async function exportAll(db: Database): Promise<{ createdAt: string; note: string; tables: Record<string, unknown[]> }> {
  const cols = (await db.query<{ table_name: string; column_name: string }>(
    `select c.table_name, c.column_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' order by c.table_name, c.ordinal_position`)).rows;
  const by = new Map<string, string[]>();
  for (const c of cols) {
    if (SKIP_TABLES.has(c.table_name) || SKIP_COLUMNS.has(c.column_name)) continue;
    by.set(c.table_name, [...(by.get(c.table_name) ?? []), c.column_name]);
  }
  const tables: Record<string, unknown[]> = {};
  for (const [t, cs] of by) tables[t] = (await db.query(`select ${cs.map((c) => `"${c}"`).join(", ")} from "${t}"`)).rows;
  return {
    createdAt: new Date().toISOString(),
    note: "個人情報を含みます。安全な場所に保管してください。パスコードは含まれません（復元したときは、オフィスが再発行します）。",
    tables,
  };
}
