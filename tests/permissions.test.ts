import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { can, canManageStaff, LEVEL_PERMISSIONS } from "../lib/permissions";

describe("画面側の権限表とDB側の権限表が同じ", () => {
  it("level_permissions の中身が一致する", () => {
    const sql = readdirSync("db/migrations").sort().map((f) => readFileSync(`db/migrations/${f}`, "utf8")).join("\n");
    const blocks = [...sql.matchAll(/insert into public\.level_permissions[^;]*;/g)].map((m) => m[0]).join("\n");
    const last = new Map<string, string>();   // あとの移行ファイルで書きかえた分が、新しい
    for (const m of blocks.matchAll(/\((\d), '([a-z._]+)', '(own|all)'\)/g)) last.set(`${m[1]}|${m[2]}`, m[3]);
    const fromSql = [...last].map(([k, v]) => `${k}|${v}`).sort();
    const fromTs = LEVEL_PERMISSIONS.map(([l, p, s]) => `${l}|${p}|${s}`).sort();
    expect(fromTs.length).toBeGreaterThan(0);
    expect(fromTs).toEqual(fromSql);
  });
});

describe("can()", () => {
  const mgr = { level: 3 as const, storeId: "s1" };
  it("店長は自店のスタッフ管理だけできる", () => {
    expect(can(mgr, "staff.manage", "s1")).toBe(true);
    expect(can(mgr, "staff.manage", "s2")).toBe(false);
  });
  it("店長は全店を見られるがレベルは変えられない", () => {
    expect(can(mgr, "staff.view", "s2")).toBe(true);
    expect(can(mgr, "level.assign", "s1")).toBe(false);
  });
  it("オフィスは全部できる", () => {
    const o = { level: 4 as const, storeId: "s1" };
    for (const p of ["staff.manage", "store.manage", "level.assign"]) expect(can(o, p, "s9")).toBe(true);
  });
  it("スタッフとシフト担当は何も管理できない", () => {
    for (const level of [1, 2] as const)
      for (const p of ["staff.manage", "store.manage", "level.assign"]) expect(can({ level, storeId: "s1" }, p, "s1")).toBe(false);
  });
});

describe("canManageStaff()", () => {
  it("店長は自店のスタッフに触れるが、同じ店のオフィス・店長には触れない", () => {
    const mgr = { level: 3 as const, storeId: "s1" };
    expect(canManageStaff(mgr, { level: 1, storeId: "s1" })).toBe(true);
    expect(canManageStaff(mgr, { level: 2, storeId: "s1" })).toBe(true);
    expect(canManageStaff(mgr, { level: 3, storeId: "s1" })).toBe(false);
    expect(canManageStaff(mgr, { level: 4, storeId: "s1" })).toBe(false);
    expect(canManageStaff(mgr, { level: 1, storeId: "s2" })).toBe(false);
  });
  it("オフィスは全員に触れる", () => {
    expect(canManageStaff({ level: 4, storeId: "s1" }, { level: 4, storeId: "s2" })).toBe(true);
  });
});
