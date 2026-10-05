import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { describeActivity, isOfficeReport } from "../lib/activity";
import { levelLabel } from "../lib/permissions";

describe("変更の記録の言葉づかい・提出の判定・レベルの表示", () => {
  it("どこ・なにを、日本語で分かる", () => {
    expect(describeActivity("/api/attendance", { action: "save" })).toEqual({ area: "出勤簿", what: "保存" });
    expect(describeActivity("/api/periods", { status: "submitted" })).toMatchObject({ area: "シフト", what: "変更（提出）" });
    expect(describeActivity("/api/staff/abc/passcode", null)).toEqual({ area: "スタッフ管理", what: "パスコードを再発行" });
    expect(describeActivity("/api/staff", null)).toEqual({ area: "スタッフ管理", what: "登録" });
  });
  it("事務員さんへの提出・報告だけを見つける", () => {
    expect(isOfficeReport("/api/periods", { status: "submitted" })).toBe(true);
    expect(isOfficeReport("/api/periods", { status: "confirmed" })).toBe(false);
    expect(isOfficeReport("/api/attendance", { action: "status", status: "submitted" })).toBe(true);
    expect(isOfficeReport("/api/attendance", { action: "save" })).toBe(false);
    expect(isOfficeReport("/api/sales", { action: "submit" })).toBe(true);
    expect(isOfficeReport("/api/stocktakes/x", { action: "status", status: "submitted" })).toBe(true);
    expect(isOfficeReport("/api/material", { action: "add" })).toBe(true);
  });
  it("レベルの表示: アプリ制作者には内訳つき、ほかの人には「レベル◯」だけ", () => {
    const boss = { level: 4, execView: true }, off = { level: 4 }, owner = { level: 4, appOwner: true };
    expect(levelLabel({ appOwner: true }, boss)).toBe("レベル4 社長（見るだけ）");
    expect(levelLabel({ appOwner: true }, owner)).toBe("レベル6 アプリ制作者");
    expect(levelLabel({}, boss)).toBe("レベル4");
    expect(levelLabel({}, off)).toBe("レベル5");
    expect(levelLabel({}, { level: 3 })).toBe("レベル3");
  });
});

describe("記録と通知", () => {
  let d: Database; const u: Record<string, string> = {}; let co = "";
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    co = (await d.query<{ id: string }>("insert into companies (code, name) values ('act-co','A') returning id")).rows[0].id;
    const sid = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A店') returning id", [co])).rows[0].id;
    const mk = async (k: string, code: string, level: number, extra = "") => { u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, sid, code, k, level])).rows[0].id; if (extra) await d.query(`update memberships set ${extra} where id = $1`, [u[k]]); };
    await mk("owner", "1", 4, "app_owner = true"); await mk("office", "2", 4); await mk("mgr", "3", 3);
  });
  it("操作を記録する（制作者本人の操作は残さない）。見られるのは制作者だけ", async () => {
    await svc.logActivity(d, u.mgr, "/api/attendance", { action: "save" });
    await svc.logActivity(d, u.owner, "/api/attendance", { action: "save" });
    await svc.logActivity(d, u.mgr, "/api/security", { action: "x" });                       // 自分のパスコードなどは残さない
    const r = await svc.listActivity(d, u.owner);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ userName: "mgr", userLevel: "レベル3", area: "出勤簿", what: "保存", storeName: "A店" });
    await expect(svc.listActivity(d, u.office)).rejects.toThrow(svc.ForbiddenError);
  });
  it("事務員さんへの提出があったら、制作者にも通知が届く", async () => {
    await svc.logActivity(d, u.mgr, "/api/attendance", { action: "status", status: "submitted" });
    const n = await svc.listNotifications(d, u.owner);
    expect(n.items.some((x) => x.title.includes("出勤簿") && x.title.includes("提出"))).toBe(true);
    expect((await svc.listNotifications(d, u.office)).items.some((x) => x.title.includes("出勤簿"))).toBe(false);   // 通知は制作者だけに
  });
});
