import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { login } from "../lib/auth/login";
import { bootstrapCompany, DEFAULT_STORE_NAMES } from "../lib/bootstrap";
import { pgliteDatabase } from "../lib/db/adapters";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
beforeAll(async () => { db = pgliteDatabase(new PGlite()); await migrate(db); });

describe("最初の設定（会社・5店舗・管理者）", () => {
  it("教えていただいた5店舗が、この順番で作られる", () => {
    expect([...DEFAULT_STORE_NAMES]).toEqual(["ATENA", "ATENA六本松", "ATENA福津", "Organ", "ATENA AVEDA SAKURAMACHI"]);
  });
  it("会社・5店舗・管理者(レベル4)ができ、管理者はそのパスコードでログインできる", async () => {
    const r = await bootstrapCompany(db, { companyCode: "album", companyName: "株式会社ALBUM", officeName: "管理者", officeCode: "9000" });
    expect(r.storeIds).toHaveLength(5);
    expect(r.office.passcode).toMatch(/^\d{6}$/);
    const l = await login(db, { companyCode: "album", employeeCode: "9000", passcode: r.office.passcode });
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    const stores = await svc.listStores(db, l.membershipId);
    expect(stores.map((s) => s.name)).toEqual([...DEFAULT_STORE_NAMES]);
    expect((await svc.getMe(db, l.membershipId))).toMatchObject({ level: 4, companyName: "株式会社ALBUM" });
  });
  it("管理者は、あとからアプリの中で、新店舗の追加・名前の変更・閉店ができる", async () => {
    const m = (await db.query<{ id: string }>("select id from memberships where employee_code = '9000'")).rows[0].id;
    await svc.addStore(db, m, "新店舗");
    expect((await svc.listStores(db, m)).map((s) => s.name)).toContain("新店舗");
    const nu = (await svc.listStores(db, m)).find((s) => s.name === "新店舗")!;
    await svc.setStoreStatus(db, m, nu.id, "closed");
    expect((await svc.listStores(db, m)).find((s) => s.id === nu.id)?.status).toBe("closed");
  });
  it("同じ会社IDでは、二度作れない（上書きしない）", async () => {
    await expect(bootstrapCompany(db, { companyCode: "ALBUM", companyName: "x", officeName: "x", officeCode: "1" })).rejects.toThrow("すでに作られています");
    expect((await db.query("select 1 from stores")).rows.length).toBeGreaterThanOrEqual(5);
  });
});
