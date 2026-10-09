import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};
let win = "";

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('v-co','V') returning id")).rows[0].id;
  for (const n of ["A店", "B店"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string, name: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
  await mk("office", "1", 4, st["A店"], "事務員"); await mk("office2", "9", 4, st["A店"], "管理者"); await mk("mgr", "2", 3, st["A店"], "A店長");
  await mk("a", "3", 1, st["A店"], "山田"); await mk("a2", "4", 1, st["A店"], "佐藤"); await mk("b", "5", 1, st["B店"], "他店");
  await mk("mgrB", "6", 3, st["B店"], "B店長");
});

describe("有給の提出と変更の申請", () => {
  it("受付を開けるのは正美さん（管理者）だけ。開くと全員にお知らせが入る", async () => {
    await expect(svc.openLeaveWindow(db, id.mgr, { label: "2026年 下期", start: "2026-10-16", end: "2027-03-15" })).rejects.toThrow(svc.ForbiddenError);
    win = await svc.openLeaveWindow(db, id.office, { label: "2026年 下期", start: "2026-10-16", end: "2027-03-15" });
    expect((await svc.listLeaveWindows(db, id.a)).find((w) => !w.standing)).toMatchObject({ label: "2026年 下期", status: "open" });
    expect((await svc.listNotifications(db, id.a)).items.some((n) => n.kind === "leave")).toBe(true);
  });

  it("受付中は、自分の有給の日を入れて提出できる。範囲の外は入れられない。直すと、もう一度提出が必要", async () => {
    await expect(svc.setMyLeaveDays(db, id.a, win, ["2026-10-10"])).rejects.toThrow("範囲");
    await svc.setMyLeaveDays(db, id.a, win, ["2026-11-20", "2027-01-08"]);
    await svc.submitMyLeave(db, id.a, win, true);
    expect((await svc.getMyLeavePlan(db, id.a, win)).submitted).toBe(true);
    await svc.setMyLeaveDays(db, id.a, win, ["2026-11-20", "2027-01-08", "2027-02-12"]);
    expect(await svc.getMyLeavePlan(db, id.a, win)).toMatchObject({ days: ["2026-11-20", "2027-01-08", "2027-02-12"], submitted: false });
    await svc.submitMyLeave(db, id.a, win, true);
    await svc.setMyLeaveDays(db, id.a2, win, ["2026-12-05"]);
    await svc.submitMyLeave(db, id.b, win, true);
  });

  it("見られる範囲: 本人・自店の店長・正美さん。他の人と他店の店長は見られない。提出状況は未提出もわかる", async () => {
    const ovA = await svc.leaveOverview(db, id.mgr, win);
    expect(ovA.map((s) => s.storeName)).toEqual(["A店"]);
    expect(ovA[0].people.map((p) => [p.name, p.submitted, p.days.length])).toEqual([["A店長", false, 0], ["山田", true, 3], ["佐藤", false, 1]]);
    expect((await svc.leaveOverview(db, id.office, win)).map((s) => s.storeName)).toEqual(["A店", "B店"]);
    await expect(svc.leaveOverview(db, id.a, win)).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.getMyLeavePlan(db, id.a2, win)).days).toEqual(["2026-12-05"]);
    expect((await svc.leaveOverview(db, id.mgrB, win))[0].people.map((p) => p.name)).toEqual(["他店", "B店長"]);
  });

  it("受付中は変更の申請はできない。締切のあとは、日を直接は直せない", async () => {
    await expect(svc.requestLeaveChange(db, id.a, win, "2026-11-20", "2026-11-27", "")).rejects.toThrow("受付中");
    await svc.setLeaveWindowStatus(db, id.office, win, "closed");
    await expect(svc.setMyLeaveDays(db, id.a, win, [])).rejects.toThrow("受付中ではありません");
    expect((await svc.getMyLeavePlan(db, id.a, win)).days).toHaveLength(3);
    await expect(svc.setLeaveWindowStatus(db, id.mgr, win, "open")).rejects.toThrow(svc.ForbiddenError);
  });

  it("申請 → 店長が確認 → 正美さんが許可 → 有給の日が書き換わる。通知が順に届く", async () => {
    const cid = await svc.requestLeaveChange(db, id.a, win, "2026-11-20", "2026-11-27", "家族の予定");
    expect((await svc.listNotifications(db, id.mgr)).items.some((n) => n.title.includes("変更の申請"))).toBe(true);
    // 順番を飛ばせない・関係ない人は決められない
    await expect(svc.decideLeaveChange(db, id.a2, cid, true, "")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.decideLeaveChange(db, id.mgrB, cid, true, "")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.decideLeaveChange(db, id.a, cid, true, "")).rejects.toThrow("自分");
    expect((await svc.listLeaveReview(db, id.mgr)).todo.map((c) => c.id)).toEqual([cid]);
    expect((await svc.listLeaveReview(db, id.mgrB)).todo).toHaveLength(0);
    expect(await svc.decideLeaveChange(db, id.mgr, cid, true, "OK")).toBe("pending_office");
    expect((await svc.getMyLeavePlan(db, id.a, win)).days).toContain("2026-11-20");                         // まだ変わらない
    expect((await svc.listNotifications(db, id.office)).items.some((n) => n.title.includes("店長が確認"))).toBe(true);
    expect((await svc.listLeaveReview(db, id.mgr)).todo).toHaveLength(0);                                   // 店長の手を離れた
    await expect(svc.decideLeaveChange(db, id.mgr, cid, true, "")).rejects.toThrow(svc.ForbiddenError);     // 正美さんの番
    expect(await svc.decideLeaveChange(db, id.office, cid, true, "了解")).toBe("approved");
    const mine = await svc.getMyLeavePlan(db, id.a, win);
    expect(mine.days).toContain("2026-11-27"); expect(mine.days).not.toContain("2026-11-20");
    expect(mine.changes[0]).toMatchObject({ status: "approved", managerComment: "OK", officeComment: "了解" });
    expect((await svc.listNotifications(db, id.a)).items.some((n) => n.title.includes("許可されました"))).toBe(true);
    await expect(svc.decideLeaveChange(db, id.office2, cid, true, "")).rejects.toThrow("すでに");
  });

  it("却下・取り消し・重複・すでにある日。店長の申請は、正美さんの許可から始まる", async () => {
    const c1 = await svc.requestLeaveChange(db, id.a2, win, "2026-12-05", null, "");
    expect(await svc.decideLeaveChange(db, id.mgr, c1, false, "人が足りません")).toBe("rejected");
    expect((await svc.getMyLeavePlan(db, id.a2, win)).days).toEqual(["2026-12-05"]);
    expect((await svc.listNotifications(db, id.a2)).items.some((n) => n.title.includes("却下"))).toBe(true);
    const c2 = await svc.requestLeaveChange(db, id.a2, win, "2026-12-05", "2026-12-12", "");
    await expect(svc.requestLeaveChange(db, id.a2, win, "2026-12-05", "2026-12-12", "")).rejects.toThrow("すでに出ています");
    await svc.cancelLeaveChange(db, id.a2, c2);
    await expect(svc.cancelLeaveChange(db, id.a, c2)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.requestLeaveChange(db, id.a2, win, "2026-12-06", null, "")).rejects.toThrow("ありません");     // 自分の有給の日ではない
    await expect(svc.requestLeaveChange(db, id.a, win, null, "2027-01-08", "")).rejects.toThrow("すでに有給");
    await expect(svc.requestLeaveChange(db, id.a, win, null, "2028-01-01", "")).rejects.toThrow("範囲");
    await svc.setLeaveWindowStatus(db, id.office, win, "closed");
    const own = await svc.requestLeaveChange(db, id.mgr, win, null, "2026-12-24", "");
    expect((await svc.getMyLeavePlan(db, id.mgr, win)).changes[0].status).toBe("pending_office");              // 店長の確認は飛ばす
    expect((await svc.listLeaveReview(db, id.office)).todo.map((c) => c.id)).toContain(own);
    expect(await svc.decideLeaveChange(db, id.office, own, true, "")).toBe("approved");
    expect((await svc.getMyLeavePlan(db, id.mgr, win)).days).toEqual(["2026-12-24"]);
  });

  it("有給申請は、受付がなくても、いつでも全員が出せる（店長が確認 → 正美さんが許可）", async () => {
    const standing = (await svc.listLeaveWindows(db, id.b)).find((w) => w.standing)!;
    expect(standing.label).toBe("有給申請");
    expect((await svc.listLeaveWindows(db, id.a)).filter((w) => w.standing)).toHaveLength(1);           // 二重に作らない
    const co = (await db.query<{ company_id: string }>("select company_id from memberships where id = $1", [id.b])).rows[0].company_id;
    await db.query("insert into shift_periods (company_id, start_date, end_date, label) values ($1,'2031-05-01','2031-05-31','テスト')", [co]);
    const c = await svc.requestLeaveChange(db, id.b, standing.id, null, "2031-05-10", "家族の予定");
    expect(await svc.decideLeaveChange(db, id.mgrB, c, true, "")).toBe("pending_office");
    expect(await svc.decideLeaveChange(db, id.office, c, true, "")).toBe("approved");
    expect((await svc.getMyLeavePlan(db, id.b, standing.id)).days).toEqual(["2031-05-10"]);
    // 許可すると、シフトカレンダー（出勤簿予定）に「有給」で入る
    expect((await db.query<{ kind: string }>("select kind from shifts where membership_id = $1 and day = '2031-05-10'", [id.b])).rows).toEqual([{ kind: "paid" }]);
    // 正美さん宛ての提出・報告は「スタッフからの通知」に集まる（正美さん以上だけが見える）
    await svc.logActivity(db, id.a, "/api/paid-leave", { action: "request" });
    const box = await svc.listOfficeInbox(db, id.office);
    expect(box.items[0]).toMatchObject({ fromName: "山田", area: "有給", link: "/leave/review", done: false });
    await expect(svc.listOfficeInbox(db, id.mgr)).rejects.toThrow(svc.ForbiddenError);
    await svc.markOfficeInboxDone(db, id.office, [box.items[0].id]);
    expect((await svc.listOfficeInbox(db, id.office)).open).toBe(0);
  });
});
