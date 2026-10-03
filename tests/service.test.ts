import { beforeAll, describe, expect, it } from "vitest";
import { login, validateSession } from "../lib/auth/login";
import { newDb } from "./helpers";
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
  db = await newDb();
  expect(await migrate(db)).toEqual(["0001_tenant_core.sql", "0002_periods_requests.sql", "0003_store_changes.sql", "0004_shifts.sql", "0005_break_rule.sql", "0006_attendance.sql", "0007_products_stocktake.sql", "0008_stock.sql", "0009_display_accounts.sql", "0010_presence.sql", "0011_saturday_hours.sql"]);
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
    await expect(svc.disableStaff(db, id.office, id.office)).rejects.toThrow("ほかに有効な管理者");
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

describe("退職者の社員番号を空ける", () => {
  it("管理者だけが、退職した人の番号を空けて、新しい人が同じ番号を使える", async () => {
    const old = await person((await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id, "2200", "退職予定", 1, store.a1);
    await expect(svc.releaseRetiredCode(db, id.office, old)).rejects.toThrow("退職");
    await svc.disableStaff(db, id.office, old);
    await expect(svc.releaseRetiredCode(db, id.mgr, old)).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.releaseRetiredCode(db, id.office, old)).toBe("2200");
    const r = await svc.addStaff(db, id.office, { name: "新しい人", employeeCode: "2200", storeId: store.a1, level: 1 });
    expect(r.passcode).toMatch(/^\d{6}$/);
    await expect(svc.releaseRetiredCode(db, id.office, old)).rejects.toThrow("すでに");
  });
});

describe("ログイン状況と並び順（管理者のみ）", () => {
  it("社員番号の小さい順に並び、管理者だけがログイン状況を見られる", async () => {
    const co = (await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id;
    const p = await svc.addStaff(db, id.office, { name: "状況テスト", employeeCode: "5500", storeId: store.a1, level: 1 });
    const codes = (await svc.listStaff(db, id.office)).map((s) => s.employeeCode);
    const nums = codes.filter((c) => /^\d+$/.test(c)).map(Number);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    let row = (await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!;
    expect(row.presence).toBe("never");
    const l = await login(db, { companyCode: "co-a", employeeCode: "5500", passcode: p.passcode });
    expect(l.ok).toBe(true);
    row = (await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!;
    expect(row.presence).toBe("online");
    await db.query("update memberships set last_seen_at = now() - interval '10 minutes' where id=$1", [p.id]);
    expect((await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!.presence).toBe("idle");
    await db.query("delete from sessions where membership_id=$1", [p.id]);
    expect((await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!.presence).toBe("loggedout");
    expect((await svc.listStaff(db, id.mgr)).every((s) => s.presence === undefined)).toBe(true);
    void co;
  });
});

describe("名前・社員番号の変更（管理者のみ）", () => {
  it("管理者は自分も含めて名前・番号を変えられ、重複は断られ、店長はできない", async () => {
    await svc.updateStaffProfile(db, id.office, id.office, { name: "成田和樹", employeeCode: "6" });
    const me = (await svc.listStaff(db, id.office)).find((s) => s.id === id.office)!;
    expect(me).toMatchObject({ name: "成田和樹", employeeCode: "6" });
    await expect(svc.updateStaffProfile(db, id.office, id.staff, { employeeCode: "6" })).rejects.toThrow("すでに");
    await expect(svc.updateStaffProfile(db, id.mgr, id.staff, { name: "x" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.updateStaffProfile(db, id.office, id.staff, { employeeCode: "あ" })).rejects.toThrow("英数字");
  });
});

describe("土曜日だけ違う営業時間", () => {
  it("お店ごとに土曜の営業時間を設定でき、曜日ごとの時間が切りかわる", async () => {
    await svc.setStoreHours(db, id.office, store.a1, "10:00", "19:00", { open: "10:00", close: "20:00" });
    const st = (await svc.listStores(db, id.office)).find((s) => s.id === store.a1)!;
    expect(st).toMatchObject({ satOpen: "10:00", satClose: "20:00" });
    const { hoursOn } = await import("../lib/labels");
    expect(hoursOn(st, "2026-10-17")).toEqual({ start: "10:00", end: "20:00" }); // 土
    expect(hoursOn(st, "2026-10-16")).toEqual({ start: "10:00", end: "19:00" }); // 金
    await expect(svc.setStoreHours(db, id.mgr, store.a1, "10:00", "19:00", null)).rejects.toThrow(svc.ForbiddenError);
    await svc.setStoreHours(db, id.office, store.a1, "10:00", "19:00", null);
    expect((await svc.listStores(db, id.office)).find((s) => s.id === store.a1)!.satOpen).toBeNull();
  });
});

describe("管理者も、ほかのスタッフと同じように扱える", () => {
  it("自分をシフトに入れる／外せる。ほかに管理者がいれば自分を退職にもできる", async () => {
    await svc.setOnShift(db, id.office, id.office, true);
    expect((await svc.listStaff(db, id.office)).find((x) => x.id === id.office)!.onShift).toBe(true);
    await svc.setOnShift(db, id.office, id.office, false);
    expect((await svc.listStaff(db, id.office)).find((x) => x.id === id.office)!.onShift).toBe(false);
    const co = (await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id;
    const admin2 = await person(co, "9001", "管理者2", 4, store.a1);
    await svc.disableStaff(db, admin2, admin2);
    expect((await svc.listStaff(db, id.office)).find((x) => x.id === admin2)!.status).toBe("disabled");
  });
});
