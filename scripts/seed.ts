// お試し用データ作成: npm run seed （本番では実行しない）
import { getDb } from "../lib/db";
import { setPasscode } from "../lib/auth/login";

const db = await getDb();
if (process.env.NODE_ENV === "production") throw new Error("本番では実行できません");
const exists = (await db.query("select 1 from companies where code = 'atena'")).rows.length > 0;
if (exists) { console.log("すでに作成済みです。"); await db.close(); process.exit(0); }

const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('atena', 'ATENA（お試し）') returning id")).rows[0].id;
const names = ["ATENA", "ATENA六本松", "ATENA福津", "Organ", "ATENA AVEDA SAKURAMACHI"];
const stores: string[] = [];
for (const [i, n] of names.entries())
  stores.push((await db.query<{ id: string }>("insert into stores (company_id, name, sort_order) values ($1,$2,$3) returning id", [co, n, i])).rows[0].id);

const people: [string, string, number, string][] = [
  ["9000", "事務員（オフィス）", 4, stores[0]], ["1001", "店長（ATENA）", 3, stores[0]],
  ["1002", "シフト担当（ATENA）", 2, stores[0]], ["1003", "大坪", 1, stores[0]], ["1004", "永尾", 1, stores[0]],
  ["2001", "店長（六本松）", 3, stores[1]], ["2002", "山田", 1, stores[1]],
];
console.log("会社ID: atena");
for (const [code, name, level, store] of people) {
  const id = (await db.query<{ id: string }>(
    "insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, store, code, name, level])).rows[0].id;
  const pc = String(Math.floor(100000 + Math.random() * 899999)); // お試し用（本番はオフィスが発行）
  const pcode = /^(\d)\1{5}$/.test(pc) ? "493817" : pc;
  await setPasscode(db, id, pcode);
  console.log(`  社員番号 ${code}  パスコード ${pcode}  … ${name}（レベル${level}）`);
}
await db.close();
