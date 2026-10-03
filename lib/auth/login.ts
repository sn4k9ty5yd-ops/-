import { createHash, randomBytes } from "node:crypto";
import { generatePasscode, hashPasscode, validatePasscode, verifyPasscode } from "./passcode";

/** pg / PGlite どちらでも使える最小のDB接続。管理用ロール（RLSを通らない接続）で渡すこと。 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export const MAX_FAILED = 5; // この回数まちがえるとロック
export const LOCK_MINUTES = 15;
export const SESSION_DAYS = 30;

export type LoginResult =
  | { ok: true; token: string; membershipId: string }
  | { ok: false; reason: "invalid" | "locked" };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// 存在しない社員番号でも同じ時間がかかるようにするためのダミー
let dummyHash: Promise<string> | undefined;

export async function login(
  db: Db,
  input: { companyCode: string; employeeCode: string; passcode: string },
): Promise<LoginResult> {
  const { rows } = await db.query<{
    id: string; passcode_hash: string | null; failed_attempts: number; locked: boolean;
  }>(
    `select m.id, m.passcode_hash, m.failed_attempts, coalesce(m.locked_until > now(), false) as locked
       from memberships m join companies c on c.id = m.company_id
      where c.code = $1 and m.employee_code = $2 and m.status = 'active' and c.status = 'active'`,
    [input.companyCode.trim().toLowerCase(), input.employeeCode.trim()],
  );
  const m = rows[0];

  if (!m || !m.passcode_hash) {
    dummyHash ??= hashPasscode("000000");
    await verifyPasscode(input.passcode, await dummyHash);
    return { ok: false, reason: "invalid" }; // 「番号が無い」のか「パスコードが違う」のかは教えない
  }
  if (m.locked) return { ok: false, reason: "locked" };

  if (!(await verifyPasscode(input.passcode, m.passcode_hash))) {
    // 原子的に加算。上限に達したらロックして回数を戻す
    await db.query(
      `update memberships
          set failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
              locked_until    = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
        where id = $1`,
      [m.id, MAX_FAILED, LOCK_MINUTES],
    );
    return { ok: false, reason: "invalid" };
  }

  await db.query(`update memberships set failed_attempts = 0, locked_until = null, last_login_at = now(), last_seen_at = now() where id = $1`, [m.id]);
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `insert into sessions (token_hash, membership_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), m.id, SESSION_DAYS],
  );
  return { ok: true, token, membershipId: m.id };
}

/** Cookie の token から「いまログインしている人」を返す。退職（無効）・期限切れは null */
export async function validateSession(db: Db, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const { rows } = await db.query<{ membership_id: string }>(
    `select s.membership_id from sessions s
       join memberships m on m.id = s.membership_id
       join companies c on c.id = m.company_id
      where s.token_hash = $1 and s.expires_at > now() and m.status = 'active' and c.status = 'active'`,
    [sha256(token)],
  );
  return rows[0]?.membership_id ?? null;
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.query(`delete from sessions where token_hash = $1`, [sha256(token)]);
}

/** パスコードの設定・再発行（オフィス/店長の操作の裏側）。ロック解除し、すべての端末をログアウトさせる */
export async function setPasscode(db: Db, membershipId: string, passcode: string): Promise<void> {
  const err = validatePasscode(passcode);
  if (err) throw new Error(err);
  await db.query(
    `update memberships set passcode_hash = $2, failed_attempts = 0, locked_until = null where id = $1`,
    [membershipId, await hashPasscode(passcode)],
  );
  await db.query(`delete from sessions where membership_id = $1`, [membershipId]);
}

export async function issuePasscode(db: Db, membershipId: string): Promise<string> {
  const pc = generatePasscode();
  await setPasscode(db, membershipId, pc);
  return pc; // 本人に1度だけ見せる。保存されるのはハッシュのみ
}
