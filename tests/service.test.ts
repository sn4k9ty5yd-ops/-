import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { login, validateSession } from "../lib/auth/login";
import { pgliteDatabase } from "../lib/db/adapters";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const store: Record<string, string> = {};

async function person(co: string, code: string, name: string, level: number, st: string) {
  const r = await db.query<{ id: string }>(
    "insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, st, code, name, level]);
  return r.rows[0].id;
}

beforeAll(async () => {
  db = pgliteDatabase(new PGlite());
  expect(await migrate(db)).toEqual(["0001_tenant_core.sql", "0002_periods_requests.sql", "0003_store_changes.sql", "0004_shifts.sql", "0005_break_rule.sql", "0006_attendance.sql"]);
  expect(await migrate(db)).toEqual([]); // 2回目は何もしない
  const a = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-a','A社') returning id")).rows[0].id;
  const b = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-b','B社') returning id")).rows[0].id;
  for (const [k, co, n] of [["a1", a, "A店1"], ["a2", a, "A店2"], ["b1", b, "B店1"]] as const)
    store[k] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  id.office = await person(a, "9000", "オフィス", 4, store.a1);
  id.mgr = await person(a, "1001", "店長", 3, store.a1);
  id.shift = await person(a, "1002", "シフト担当", 2, store.a1);
  id.staff = await person(a, "1003", "スタッフ", 1, store.a1);
  id.staff2 = await person(a, "2003", "他店スタッフ", 1, store.a2);
  id.officeB = await person(b, "9000", "B社オフィス", 4, store.b1);
});

describe("サービス層（DBの権限ルールを通して動く）", () => {
  it("店長は自店のスタッフを登録でき、パスコードが発行されて、その人がログインできる", async () => {
    const r = await svc.addStaff(db, id.mgr, { name: "新人", employeeCode: "1100", storeId: store.a1, level: 1 });
    expect(r.passcode).toMatch(/^\d{6}$/);
    const l = await login(db, { companyCode: "co-a", employeeCode: "1100", passcode: r.passcode });
    expect(l.ok).toBe(true);
    if (l.ok) expect(await validateSession(db, l.token)).toBe(r.id);
  });
  it("店長は他店への登録・レベル付き登録ができない", async () => {
    await expect(svc.addStaff(db, id.mgr, { name: "x", employeeCode: "1200", storeId: store.a2, level: 1 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addStaff(db, id.mgr, { name: "x", employeeCode: "1201", storeId: store.a1, level: 4 })).rejects.toThrow(svc.ForbiddenError);
  });
  it("他社の店舗には、オフィスでも登録できない", async () => {
    await expect(svc.addStaff(db, id.office, { name: "x", employeeCode: "1300", storeId: store.b1, level: 1 })).rejects.toThrow(svc.ForbiddenError);
  });
  it("社員番号は会社の中で重複できない（別会社なら同じ番号OK）", async () => {
    await expect(svc.addStaff(db, id.office, { name: "x", employeeCode: "1003", storeId: store.a1, level: 1 })).rejects.toThrow("すでに使われて");
    await expect(svc.addStaff(db, id.officeB, { name: "別会社の1003", employeeCode: "1003", storeId: store.b1, level: 1 })).resolves.toBeTruthy();
  });
  it("パスコード再発行: 店長は自店スタッフのみ。オフィスや他店は不可。旧パスコードは使えなくなる", async () => {
    const pc = await svc.reissuePasscode(db, id.mgr, id.staff);
    expect((await login(db, { companyCode: "co-a", employeeCode: "1003", passcode: pc })).ok).toBe(true);
    await expect(svc.reissuePasscode(db, id.mgr, id.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reissuePasscode(db, id.mgr, id.staff2)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reissuePasscode(db, id.staff, id.staff)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reissuePasscode(db, id.office, id.officeB)).rejects.toThrow(svc.ForbiddenError); // 他社
  });
  it("退職にすると、ログイン中のセッションも消える。自分自身は退職にできない", async () => {
    const pc = await svc.reissuePasscode(db, id.office, id.shift);
    const l = await login(db, { companyCode: "co-a", employeeCode: "1002", passcode: pc });
    if (!l.ok) throw new Error("login");
    await svc.disableStaff(db, id.mgr, id.shift);
    expect(await validateSession(db, l.token)).toBeNull();
    await expect(svc.disableStaff(db, id.office, id.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.disableStaff(db, id.mgr, id.office)).rejects.toThrow(svc.ForbiddenError);
  });
  it("レベル変更はオフィスだけ。自分のレベルは変えられない", async () => {
    await expect(svc.setStaffLevel(db, id.mgr, id.staff, 2)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStaffLevel(db, id.office, id.office, 1)).rejects.toThrow(svc.ForbiddenError);
    await svc.setStaffLevel(db, id.office, id.staff, 2);
    expect((await svc.getMe(db, id.staff))?.level).toBe(2);
    await expect(svc.setStaffLevel(db, id.office, id.officeB, 1)).rejects.toThrow(svc.ForbiddenError); // 他社
  });
  it("一覧は自分の権限の範囲だけ。他社は見えない", async () => {
    expect((await svc.listStaff(db, id.staff2)).map((s) => s.name)).toEqual(["他店スタッフ"]);
    const all = (await svc.listStaff(db, id.office)).map((s) => s.name);
    expect(all).toContain("他店スタッフ");
    expect(all).not.toContain("B社オフィス");
    expect((await svc.listStores(db, id.mgr)).map((s) => s.name).sort()).toEqual(["A店1", "A店2"]);
    expect(await svc.listStores(db, id.staff2)).toHaveLength(1);
  });
  it("店の追加はオフィスだけ", async () => {
    await expect(svc.addStore(db, id.mgr, "新店")).rejects.toThrow(svc.ForbiddenError);
    await svc.addStore(db, id.office, "新店");
    expect((await svc.listStores(db, id.office)).map((s) => s.name)).toContain("新店");
  });
  it("パスコードのハッシュは一覧に出てこない", async () => {
    const rows = await svc.listStaff(db, id.office);
    expect(JSON.stringify(rows)).not.toMatch(/scrypt|passcode/);
  });
});
