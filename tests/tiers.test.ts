import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { asUser } from "../lib/db/user-context";
import { isOfficeOnly, tierOf } from "../lib/permissions";

describe("レベル4（社長・見るだけ）・5（事務員さん）・6（アプリ制作者）", () => {
  let d: Database; const u: Record<string, string> = {}; let sid = "";
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('tier-co','T') returning id")).rows[0].id;
    sid = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A') returning id", [co])).rows[0].id;
    const mk = async (k: string, code: string, level: number, extra = "") => {
      u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, sid, code, k, level])).rows[0].id;
      if (extra) await d.query(`update memberships set ${extra} where id = $1`, [u[k]]);
    };
    await mk("owner", "1", 4, "app_owner = true"); await mk("office", "2", 4); await mk("boss", "3", 4, "exec_view = true"); await mk("staff", "4", 1);
    await svc.setRank(d, u.owner, u.staff, "assistant");
  });
  it("画面のレベル: 制作者=6・事務員=5・社長=4。レッスンの状況を見られないのは事務員さんだけ", async () => {
    const t = async (k: string) => tierOf((await svc.getMe(d, u[k]))!);
    expect([await t("owner"), await t("office"), await t("boss"), await t("staff")]).toEqual([6, 5, 4, 1]);
    expect(isOfficeOnly((await svc.getMe(d, u.office))!)).toBe(true);
    const edu = async (k: string) => (await asUser(d, u[k], (q) => q.query<{ v: boolean }>("select app.is_edu($1) as v", [sid]))).rows[0].v;
    expect([await edu("office"), await edu("boss"), await edu("owner")]).toEqual([false, true, true]);
  });
  it("他の人のレベルは見えない（制作者だけ全員分・自分の分は見える）", async () => {
    const lv = async (viewer: string, target: string) => (await svc.listStaff(d, u[viewer])).find((s) => s.id === u[target])?.level;
    expect(await lv("office", "boss")).toBe(0);
    expect(await lv("office", "office")).toBe(4);
    expect(await lv("owner", "boss")).toBe(4);
    expect(await lv("staff", "office")).toBe(0);
  });
  it("レベル4・5に決められるのは、アプリ制作者だけ。事務員さんは社長のアカウントを変えられない", async () => {
    await expect(svc.setStaffLevel(d, u.office, u.staff, 4)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStaffLevel(d, u.office, u.staff, 5)).rejects.toThrow(svc.ForbiddenError);
    await svc.setStaffLevel(d, u.office, u.staff, 2);                                       // 1〜3は、事務員さんもできる
    await svc.setStaffLevel(d, u.owner, u.staff, 4);
    expect(tierOf((await svc.getMe(d, u.staff))!)).toBe(4);                                 // 社長（見るだけ）
    await expect(svc.reissuePasscode(d, u.office, u.staff)).rejects.toThrow(svc.ForbiddenError);   // 社長のアカウントは、制作者だけ
    await svc.setStaffLevel(d, u.owner, u.staff, 5);
    expect(tierOf((await svc.getMe(d, u.staff))!)).toBe(5);
    await svc.setStaffLevel(d, u.owner, u.staff, 1);
    expect(tierOf((await svc.getMe(d, u.staff))!)).toBe(1);
    await expect(svc.setStaffLevel(d, u.owner, u.owner, 1)).rejects.toThrow();            // 自分のレベルは変えられない
  });
  it("アカウントを作るとき、レベル4・5は制作者だけ", async () => {
    await expect(svc.addStaff(d, u.office, { name: "X", employeeCode: "50", storeId: sid, level: 4 })).rejects.toThrow(svc.ForbiddenError);
    const r = await svc.addStaff(d, u.owner, { name: "社長2", employeeCode: "51", storeId: sid, level: 4 });
    expect(tierOf((await svc.getMe(d, r.id))!)).toBe(4);
    const r2 = await svc.addStaff(d, u.owner, { name: "事務員2", employeeCode: "52", storeId: sid, level: 5 });
    expect(tierOf((await svc.getMe(d, r2.id))!)).toBe(5);
  });
});
