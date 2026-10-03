import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { pgliteDatabase } from "../lib/db/adapters";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};

beforeAll(async () => {
  db = pgliteDatabase(new PGlite());
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st.s1); await mk("mgr1", "2", 3, st.s1); await mk("staff1", "3", 1, st.s1); await mk("staff2", "4", 1, st.s2);
});

describe("期間と希望休のサービス", () => {
  it("期間を作れるのはオフィスだけ。作ると全店舗の進行状況が「準備中」で用意される", async () => {
    await expect(svc.createNextPeriod(db, id.mgr1, "2026-10-20")).rejects.toThrow(svc.ForbiddenError);
    await svc.createNextPeriod(db, id.office, "2026-10-20");
    const ps = await svc.listPeriods(db, id.office);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ label: "10/16〜11/15", start: "2026-10-16", end: "2026-11-15" });
    expect(ps[0].stores.map((s) => s.status)).toEqual(["preparing", "preparing"]);
  });
  it("2回目は続きの期間（11/16〜12/15）ができる", async () => {
    await svc.createNextPeriod(db, id.office, "2026-10-20");
    expect((await svc.listPeriods(db, id.office)).map((p) => p.label)).toEqual(["11/16〜12/15", "10/16〜11/15"]);
  });
  it("店長は自店の期間だけ見える/動かせる。スタッフは動かせない", async () => {
    const p = (await svc.listPeriods(db, id.office))[0];
    expect((await svc.listPeriods(db, id.staff2))[0].stores.map((s) => s.storeId)).toEqual([st.s2]);
    await svc.setPeriodStatus(db, id.mgr1, { periodId: p.id, storeId: st.s1, status: "collecting" });
    await expect(svc.setPeriodStatus(db, id.mgr1, { periodId: p.id, storeId: st.s2, status: "collecting" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setPeriodStatus(db, id.staff1, { periodId: p.id, storeId: st.s1, status: "closed" })).rejects.toThrow(svc.ForbiddenError);
  });
  it("希望休: 受付中の店舗のスタッフはオン/オフでき、受付前の店舗では変更できない", async () => {
    const p = (await svc.listPeriods(db, id.office))[0];
    expect(await svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-18")).toBe("added");
    expect((await svc.listRequests(db, id.staff1, p.id)).map((r) => r.day)).toEqual(["2026-11-18"]);
    expect(await svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-18")).toBe("removed");
    await expect(svc.toggleMyRequest(db, id.staff2, p.id, "2026-11-18")).rejects.toThrow("変更できません"); // s2は準備中
    await expect(svc.toggleMyRequest(db, id.staff1, p.id, "2027-01-01")).rejects.toThrow("変更できません"); // 期間外
  });
  it("締切にすると変更できない。他の人の希望休は店長には見え、同僚には見えない", async () => {
    const p = (await svc.listPeriods(db, id.office))[0];
    await svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-20");
    expect((await svc.listRequests(db, id.mgr1, p.id)).map((r) => r.membershipId)).toEqual([id.staff1]);
    expect(await svc.listRequests(db, id.staff2, p.id)).toEqual([]);
    await svc.setPeriodStatus(db, id.mgr1, { periodId: p.id, storeId: st.s1, status: "closed" });
    await expect(svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-21")).rejects.toThrow("変更できません");
    await expect(svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-20")).rejects.toThrow("変更できません"); // 消すのも不可
  });
});
