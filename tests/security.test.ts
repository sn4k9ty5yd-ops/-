import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { changeOwnPasscode, issuePasscode, login, logoutOthers, recordLogin, validateSession } from "../lib/auth/login";
import { validatePasscode } from "../lib/auth/passcode";

let db: Database;
const id: Record<string, string> = {};

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('sec','S') returning id")).rows[0].id;
  const st = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A') returning id", [co])).rows[0].id;
  const mk = async (k: string, code: string, level: number, display = false) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level, display_only, on_shift) values ($1,$2,$3,$4,$5,$6,$7) returning id", [co, st, code, k, level, display, !display])).rows[0].id);
  await mk("office", "1", 4); await mk("staff", "2", 1); await mk("ipad", "3", 1, true);
});

describe("セキュリティ", () => {
  it("かんたんすぎるパスコードは使えない", () => {
    for (const bad of ["111111", "123456", "654321", "121212", "123123", "12345", "abcdef"]) expect(validatePasscode(bad), bad).not.toBeNull();
    expect(validatePasscode("493027")).toBeNull();
  });

  it("発行されたパスコードは、最初に変える必要がある（お店のiPad用は除く）。本人が変えると解除され、ほかの端末はログアウト", async () => {
    const pc = await issuePasscode(db, id.staff);
    await issuePasscode(db, id.ipad);
    expect((await svc.getMe(db, id.staff))?.mustChangePasscode).toBe(true);
    expect((await svc.getMe(db, id.ipad))?.mustChangePasscode).toBe(false);
    const a = await login(db, { companyCode: "sec", employeeCode: "2", passcode: pc });
    const b = await login(db, { companyCode: "sec", employeeCode: "2", passcode: pc });
    if (!a.ok || !b.ok) throw new Error("login");
    await expect(changeOwnPasscode(db, id.staff, "000999", "493027", a.token)).rejects.toThrow("いまのパスコードが違います");
    await expect(changeOwnPasscode(db, id.staff, pc, "111111", a.token)).rejects.toThrow("同じ数字");
    await expect(changeOwnPasscode(db, id.staff, pc, pc, a.token)).rejects.toThrow("いまと同じ");
    await changeOwnPasscode(db, id.staff, pc, "493027", a.token);
    expect((await svc.getMe(db, id.staff))?.mustChangePasscode).toBe(false);
    expect(await validateSession(db, a.token)).toBe(id.staff);          // いまの端末は続けて使える
    expect(await validateSession(db, b.token)).toBeNull();               // ほかの端末は、ログアウト
    expect((await login(db, { companyCode: "sec", employeeCode: "2", passcode: pc })).ok).toBe(false);          // 古いパスコードは使えない
    const c = await login(db, { companyCode: "sec", employeeCode: "2", passcode: "493027" });
    expect(c.ok).toBe(true);
    if (c.ok) { expect(await logoutOthers(db, id.staff, a.token)).toBe(1); expect(await validateSession(db, c.token)).toBeNull(); expect(await validateSession(db, a.token)).toBe(id.staff); }
  });

  it("ログインの記録: 本人は自分の成功だけ、管理者は会社ぜんぶ（失敗の回数つき）。スタッフは管理者の画面を見られない", async () => {
    await recordLogin(db, { companyCode: "sec", employeeCode: "2", ok: true, reason: "ok", ip: "1.1.1.1", ua: "iPhone Safari", membershipId: id.staff });
    for (let i = 0; i < 3; i++) await recordLogin(db, { companyCode: "sec", employeeCode: "999", ok: false, reason: "invalid", ip: "9.9.9.9", ua: "curl" });
    const mine = await svc.securityOverview(db, id.staff);
    expect(mine.admin).toBeNull();
    expect(mine.mine).toHaveLength(1);
    expect(mine.mine[0].ip).toBe("1.1.1.1");
    const adm = await svc.securityOverview(db, id.office);
    expect(adm.admin?.failedByCode).toEqual([{ code: "999", n: 3 }]);
    expect(adm.admin?.recent.length).toBe(4);
    expect(adm.admin?.audit.length).toBeGreaterThan(0);
  });
});
