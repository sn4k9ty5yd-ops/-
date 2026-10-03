// お試し用データ作成: npm run seed （本番では実行しない）
import { getDb } from "../lib/db";
import { bootstrapCompany } from "../lib/bootstrap";
import { setPasscode } from "../lib/auth/login";

async function main() {

  const db = await getDb();
  if (process.env.NODE_ENV === "production") throw new Error("本番では実行できません");
  const exists = (await db.query("select 1 from companies where code = 'atena'")).rows.length > 0;
  if (exists) { console.log("すでに作成済みです。"); await db.close(); return; }

  const boot = await bootstrapCompany(db, { companyCode: "atena", companyName: "ATENA（お試し）", officeName: "事務員（オフィス）", officeCode: "9000" });
  const co = boot.companyId; const stores = boot.storeIds;
  console.log("会社ID: atena");
  console.log(`  社員番号 9000  パスコード ${boot.office.passcode}  … 事務員（オフィス）（レベル4）`);

  const people: [string, string, number, string][] = [
    ["1001", "店長（ATENA）", 3, stores[0]],
    ["1002", "シフト担当（ATENA）", 2, stores[0]], ["1003", "大坪", 1, stores[0]], ["1004", "永尾", 1, stores[0]],
    ["2001", "店長（六本松）", 3, stores[1]], ["2002", "山田", 1, stores[1]],
  ];
  for (const [code, name, level, store] of people) {
    const id = (await db.query<{ id: string }>(
      "insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, store, code, name, level])).rows[0].id;
    const pc = String(Math.floor(100000 + Math.random() * 899999)); // お試し用（本番はオフィスが発行）
    if (level === 4) await db.query("update memberships set on_shift = false where id = $1", [id]);
    const pcode = /^(\d)\1{5}$/.test(pc) ? "493817" : pc;
    await setPasscode(db, id, pcode);
    console.log(`  社員番号 ${code}  パスコード ${pcode}  … ${name}（レベル${level}）`);
  }
  await db.close();

}
main().catch((e) => { console.error(e); process.exit(1); });
