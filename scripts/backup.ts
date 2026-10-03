// バックアップ: npm run backup  → backups/YYYY-MM-DD.json に全データを書き出す
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb } from "../lib/db";

async function main() {

  const TABLES = ["companies", "stores", "level_permissions", "memberships", "audit_logs"]; // sessions は含めない
  const db = await getDb();
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = (await db.query(`select * from ${t}`)).rows;
  mkdirSync("backups", { recursive: true });
  const file = `backups/${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), tables: out }, null, 2), { mode: 0o600 });
  console.log(`書き出しました: ${file}（${TABLES.map((t) => `${t}:${out[t].length}`).join(" ")}）`);
  console.log("※個人情報を含みます。安全な場所に保管してください。");
  await db.close();

}
main().catch((e) => { console.error(e); process.exit(1); });
