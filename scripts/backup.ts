// バックアップ: npm run backup  → backups/YYYY-MM-DD.json に全データを書き出す（パスコードは含まない）
import { mkdirSync, writeFileSync } from "node:fs";
import { exportAll } from "../lib/backup";
import { getDb } from "../lib/db";

async function main() {
  const db = await getDb();
  const out = await exportAll(db);
  mkdirSync("backups", { recursive: true });
  const file = `backups/${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(`書き出しました: ${file}`);
  console.log(Object.entries(out.tables).map(([t, r]) => `${t}:${r.length}`).join(" "));
  console.log("※個人情報を含みます。安全な場所に保管してください。");
  await db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
