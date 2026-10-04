import { generatePasscode, hashPasscode } from "./auth/passcode";
import type { Database } from "./db/types";

/** 最初に登録するお店（正式名称）。あとからアプリの「店舗の編集」でいつでも追加・変更・閉店できる */
export const DEFAULT_STORE_NAMES = ["ATENA天神", "ATENA六本松", "ATENA福津", "Organ", "ATENA AVEDA SAKURAMACHI"] as const;

export interface BootstrapResult { companyId: string; storeIds: string[]; office: { id: string; employeeCode: string; passcode: string } }

/**
 * 最初の設定: 会社・お店・管理者（オフィス＝レベル4）を作る。管理者のパスコードは、ここで1度だけ表示される。
 * すでに同じ会社IDがあれば何もしない（上書きしない）。
 */
export async function bootstrapCompany(
  db: Database,
  opts: { companyCode: string; companyName: string; officeName: string; officeCode: string; storeNames?: readonly string[] },
): Promise<BootstrapResult> {
  const code = opts.companyCode.trim().toLowerCase();
  if ((await db.query("select 1 from companies where code = $1", [code])).rows.length > 0) throw new Error(`会社ID「${code}」は、すでに作られています`);
  const names = opts.storeNames ?? DEFAULT_STORE_NAMES;
  return db.tx(async (q) => {
    const companyId = (await q.query<{ id: string }>("insert into companies (code, name) values ($1,$2) returning id", [code, opts.companyName])).rows[0].id;
    const storeIds: string[] = [];
    for (const [i, n] of names.entries())
      storeIds.push((await q.query<{ id: string }>("insert into stores (company_id, name, sort_order) values ($1,$2,$3) returning id", [companyId, n, i])).rows[0].id);
    const officeId = (await q.query<{ id: string }>(
      "insert into memberships (company_id, store_id, employee_code, name, level, on_shift) values ($1,$2,$3,$4,4,false) returning id",
      [companyId, storeIds[0], opts.officeCode.trim(), opts.officeName])).rows[0].id;
    const passcode = generatePasscode();
    await q.query("update memberships set passcode_hash = $2 where id = $1", [officeId, await hashPasscode(passcode)]);
    return { companyId, storeIds, office: { id: officeId, employeeCode: opts.officeCode.trim(), passcode } };
  });
}
