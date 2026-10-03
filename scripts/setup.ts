// 最初の設定: npm run setup
//   会社・5店舗（ATENA／ATENA六本松／ATENA福津／Organ／ATENA AVEDA SAKURAMACHI）・管理者アカウントを作る。
//   変えたいときは環境変数: COMPANY_CODE, COMPANY_NAME, OFFICE_NAME, OFFICE_CODE
import { bootstrapCompany, DEFAULT_STORE_NAMES } from "../lib/bootstrap";
import { getDb } from "../lib/db";

async function main() {
  const db = await getDb();
  const r = await bootstrapCompany(db, {
    companyCode: process.env.COMPANY_CODE ?? "album",
    companyName: process.env.COMPANY_NAME ?? "株式会社ALBUM",
    officeName: process.env.OFFICE_NAME ?? "管理者",
    officeCode: process.env.OFFICE_CODE ?? "9000",
  });
  console.log("作成しました。");
  console.log(`  会社ID: ${process.env.COMPANY_CODE ?? "album"}`);
  console.log(`  お店: ${DEFAULT_STORE_NAMES.join(" / ")}`);
  console.log(`  管理者  社員番号: ${r.office.employeeCode}  パスコード: ${r.office.passcode}   ← このパスコードは今だけ表示されます。控えてください`);
  console.log("ログイン後、「店舗の編集」で、お店の追加・名前の変更・閉店ができます。");
  await db.close();
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
