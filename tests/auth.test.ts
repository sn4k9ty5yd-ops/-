import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCK_MINUTES, MAX_FAILED, issuePasscode, login, logout, setPasscode, validateSession } from "../lib/auth/login";
import { generatePasscode, hashPasscode, validatePasscode, verifyPasscode } from "../lib/auth/passcode";

let db: PGlite;
const CO = "a0000000-0000-0000-0000-000000000001";
const ST = "a1000000-0000-0000-0000-000000000001";
const ID = { taro: "00000000-0000-0000-0000-000000000011", gone: "00000000-0000-0000-0000-000000000012", other: "00000000-0000-0000-0000-000000000013" };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("db/migrations/0001_tenant_core.sql", "utf8"));
  await db.exec(readFileSync("db/migrations/0010_presence.sql", "utf8"));
  await db.exec(readFileSync("db/migrations/0012_scheduled_retirement.sql", "utf8"));
  await db.exec(`
    insert into companies (id, code, name) values ('${CO}', 'atena', 'A社'), ('b0000000-0000-0000-0000-000000000001', 'other', 'B社');
    insert into stores (id, company_id, name) values ('${ST}', '${CO}', '店');
    insert into stores (id, company_id, name) values ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'B店');
    insert into memberships (id, company_id, store_id, employee_code, name, level) values
      ('${ID.taro}', '${CO}', '${ST}', '1001', '太郎', 1),
      ('${ID.gone}', '${CO}', '${ST}', '1002', '退職者', 1),
      ('${ID.other}', 'b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '1001', '別会社の1001', 1);
  `);
  await setPasscode(db, ID.taro, "493817");
  await setPasscode(db, ID.gone, "582913");
  await setPasscode(db, ID.other, "716204");
});

const attempt = (company: string, code: string, pc: string) => login(db, { companyCode: company, employeeCode: code, passcode: pc });

describe("パスコード", () => {
  it("6けたの数字のみ。同じ数字・連番は不可", () => {
    expect(validatePasscode("493817")).toBeNull();
    for (const bad of ["12345", "1234567", "abcdef", "111111", "123456", "654321", "012345", ""]) expect(validatePasscode(bad)).not.toBeNull();
  });
  it("ハッシュは毎回違い、元の数字は含まれない。検証できる", async () => {
    const a = await hashPasscode("493817"), b = await hashPasscode("493817");
    expect(a).not.toBe(b);
    expect(a).not.toContain("493817");
    expect(await verifyPasscode("493817", a)).toBe(true);
    expect(await verifyPasscode("493818", a)).toBe(false);
  });
  it("発行されるパスコードは常に形式を満たす", () => {
    for (let i = 0; i < 200; i++) expect(validatePasscode(generatePasscode())).toBeNull();
  });
  it("DBにはハッシュしか保存されない", async () => {
    const r = await db.query<{ passcode_hash: string }>(`select passcode_hash from memberships where id='${ID.taro}'`);
    expect(r.rows[0].passcode_hash.startsWith("scrypt$")).toBe(true);
    expect(r.rows[0].passcode_hash).not.toContain("493817");
  });
});

describe("ログイン", () => {
  it("正しい会社ID・社員番号・パスコードでログインでき、セッションが有効", async () => {
    const r = await attempt("atena", "1001", "493817");
    expect(r.ok).toBe(true);
    if (r.ok) expect(await validateSession(db, r.token)).toBe(ID.taro);
  });
  it("会社IDの大文字小文字・前後の空白は問題にしない", async () => {
    expect((await attempt(" ATENA ", " 1001 ", "493817")).ok).toBe(true);
  });
  it("同じ社員番号でも会社ごとに別人（他社のパスコードでは入れない）", async () => {
    expect((await attempt("atena", "1001", "716204")).ok).toBe(false);
    const r = await attempt("other", "1001", "716204");
    expect(r.ok && r.membershipId).toBe(ID.other);
  });
  it("存在しない社員番号・会社ID・誤パスコードは、同じ「invalid」（理由を教えない）", async () => {
    for (const r of [await attempt("atena", "9999", "493817"), await attempt("nope", "1001", "493817"), await attempt("atena", "1001", "000001")])
      expect(r).toEqual({ ok: false, reason: "invalid" });
  });
  it("パスコード未設定のアカウントは入れない", async () => {
    await db.exec(`insert into memberships (company_id, store_id, employee_code, name) values ('${CO}','${ST}','1003','未設定')`);
    expect(await attempt("atena", "1003", "493817")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("ロック（総当たり対策）", () => {
  it(`${MAX_FAILED}回まちがえると${LOCK_MINUTES}分ロックされ、正しいパスコードでも入れない`, async () => {
    await setPasscode(db, ID.taro, "493817");
    for (let i = 0; i < MAX_FAILED; i++) expect((await attempt("atena", "1001", "000001")).ok).toBe(false);
    expect(await attempt("atena", "1001", "493817")).toEqual({ ok: false, reason: "locked" });
  });
  it("ロックは時間がたつと解除される", async () => {
    await db.exec(`update memberships set locked_until = now() - interval '1 minute' where id='${ID.taro}'`);
    expect((await attempt("atena", "1001", "493817")).ok).toBe(true);
  });
  it("成功すると失敗回数がリセットされる", async () => {
    await attempt("atena", "1001", "000001");
    await attempt("atena", "1001", "000001");
    await attempt("atena", "1001", "493817");
    const r = await db.query<{ failed_attempts: number }>(`select failed_attempts from memberships where id='${ID.taro}'`);
    expect(r.rows[0].failed_attempts).toBe(0);
  });
  it("オフィスによる再発行でロックが解除される", async () => {
    for (let i = 0; i < MAX_FAILED; i++) await attempt("atena", "1001", "000001");
    const pc = await issuePasscode(db, ID.taro);
    expect((await attempt("atena", "1001", pc)).ok).toBe(true);
    await setPasscode(db, ID.taro, "493817"); // 以降のテストのために元に戻す
  });
});

describe("セッションと退職", () => {
  it("ログアウトするとセッションは無効", async () => {
    const r = await attempt("atena", "1001", "493817");
    if (!r.ok) throw new Error("login failed");
    await logout(db, r.token);
    expect(await validateSession(db, r.token)).toBeNull();
  });
  it("期限切れ・でたらめなトークンは無効", async () => {
    const r = await attempt("atena", "1001", "493817");
    if (!r.ok) throw new Error("login failed");
    await db.exec(`update sessions set expires_at = now() - interval '1 second'`);
    expect(await validateSession(db, r.token)).toBeNull();
    expect(await validateSession(db, "でたらめ")).toBeNull();
    expect(await validateSession(db, undefined)).toBeNull();
  });
  it("セッションの中身（トークン）はDBに平文で保存されない", async () => {
    const r = await attempt("atena", "1001", "493817");
    if (!r.ok) throw new Error("login failed");
    const rows = (await db.query<{ token_hash: string }>("select token_hash from sessions")).rows;
    expect(rows.some((x) => x.token_hash === r.token)).toBe(false);
  });
  it("退職（無効化）すると、ログイン中の端末も即座に使えなくなり、新しくも入れない", async () => {
    const r = await attempt("atena", "1002", "582913");
    if (!r.ok) throw new Error("login failed");
    expect(await validateSession(db, r.token)).toBe(ID.gone);
    await db.exec(`update memberships set status='disabled' where id='${ID.gone}'`);
    expect(await validateSession(db, r.token)).toBeNull();
    expect(await attempt("atena", "1002", "582913")).toEqual({ ok: false, reason: "invalid" });
  });
  it("パスコード変更で、すべての端末がログアウトされる", async () => {
    const r = await attempt("atena", "1001", "493817");
    if (!r.ok) throw new Error("login failed");
    await setPasscode(db, ID.taro, "493817");
    expect(await validateSession(db, r.token)).toBeNull();
  });
  it("会社が停止されたらログインできない", async () => {
    await db.exec(`update companies set status='suspended' where id='${CO}'`);
    expect(await attempt("atena", "1001", "493817")).toEqual({ ok: false, reason: "invalid" });
    await db.exec(`update companies set status='active' where id='${CO}'`);
  });
});
