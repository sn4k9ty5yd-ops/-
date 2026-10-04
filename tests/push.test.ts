import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { endpoint: string; body: { title: string; body: string; url: string } }[] = [];
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "pub-test", privateKey: "priv-test" }),
    sendNotification: async (sub: { endpoint: string }, body: string) => { sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) }); },
  },
}));

import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
let periodId = "";
const id: Record<string, string> = {};
const st: Record<string, string> = {};

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('p-co','P') returning id")).rows[0].id;
  for (const n of ["ATENA", "六本松"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string, name: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
  await mk("office", "1", 4, st["ATENA"], "事務員"); await mk("mgr", "2", 3, st["ATENA"], "店長 太郎"); await mk("shift", "3", 2, st["ATENA"], "担当 花子");
  await mk("a", "4", 1, st["ATENA"], "山田 一郎"); await mk("b", "5", 1, st["ATENA"], "佐藤 次郎"); await mk("c", "6", 1, st["六本松"], "他店 三郎");
  await svc.setOnShift(db, id.office, id.office, false);
  await svc.createNextPeriod(db, id.office, "2026-11-20");
  periodId = (await svc.listPeriods(db, id.office))[0].id;
  await db.query("update store_period_status set status = \'drafting\' where period_id = $1 and store_id = $2", [periodId, st["ATENA"]]);   // 自動の下書きなしで「作成中」にする
});
beforeEach(() => { sent.length = 0; });

describe("スマホへの通知", () => {
  it("朝の通知の設定: 初期は全店オン・8:30。店長は自店だけ、5分きざみで変えられる", async () => {
    const s = await svc.getNoticeSettings(db, id.mgr);
    expect(s.map((x) => [x.name, x.enabled, x.time, x.editable])).toEqual([["ATENA", true, "08:30", true], ["六本松", true, "08:30", false]]);
    await svc.setNoticeSetting(db, id.mgr, st["ATENA"], true, "09:05");
    expect((await svc.getNoticeSettings(db, id.mgr))[0].time).toBe("09:05");
    await expect(svc.setNoticeSetting(db, id.mgr, st["ATENA"], true, "09:07")).rejects.toThrow("5分");
    await expect(svc.setNoticeSetting(db, id.mgr, st["六本松"], true, "09:00")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setNoticeSetting(db, id.a, st["ATENA"], true, "09:00")).rejects.toThrow(svc.ForbiddenError);
    await svc.setNoticeSetting(db, id.office, st["六本松"], false, "07:45");            // 管理者は全店
    expect((await svc.getNoticeSettings(db, id.office)).map((x) => [x.enabled, x.time])).toEqual([[true, "09:05"], [false, "07:45"]]);
    await svc.setNoticeSetting(db, id.mgr, st["ATENA"], true, "08:30");
  });

  it("端末を登録でき、他の人の登録は見えない", async () => {
    await svc.subscribePush(db, id.a, { endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" });
    await svc.subscribePush(db, id.b, { endpoint: "https://push.example/b", p256dh: "k2", auth: "a2" });
    expect(await svc.countMyPushDevices(db, id.a)).toBe(1);
    await expect(svc.subscribePush(db, id.a, { endpoint: "http://insecure", p256dh: "k", auth: "a" })).rejects.toThrow("登録");
    expect(await svc.sendTestPush(db, id.a)).toBe(1);
    expect(sent.map((x) => x.endpoint)).toEqual(["https://push.example/a"]);
  });

  it("シフトを公開すると、そのお店の全員に通知が届き、お知らせにも入る", async () => {
    await svc.setPeriodStatus(db, id.mgr, { periodId, storeId: st["ATENA"], status: "published" });
    expect(sent.map((x) => x.endpoint).sort()).toEqual(["https://push.example/a", "https://push.example/b"]);
    expect(sent[0].body.title).toContain("シフトが公開されました");
    const inbox = await svc.listNotifications(db, id.a);
    expect(inbox.items.some((n) => n.kind === "shift")).toBe(true);
  });

  it("毎朝の通知: 時刻になったらその日1回だけ。出勤と休みの人が入る。時刻前・オフのお店・シフトが無いお店には送らない", async () => {
    const co = (await db.query<{ id: string }>("select company_id as id from stores where id = $1", [st["ATENA"]])).rows[0].id;
    for (const k of ["mgr", "shift", "b"]) await db.query("insert into shifts (company_id, store_id, period_id, membership_id, day, kind, start_time, end_time) values ($1,$2,$3,$4,'2026-11-21','work','10:00','19:00')", [co, st["ATENA"], periodId, id[k]]);
    await db.query("insert into shifts (company_id, store_id, period_id, membership_id, day, kind) values ($1,$2,$3,$4,'2026-11-21','holiday')", [co, st["ATENA"], periodId, id.a]);
    const before = await svc.runMorningNotices(db, true, "2026-11-21T08:10:00Z");
    expect(before).toEqual({ stores: 0, sent: 0 });                                       // 8:30より前
    expect(sent).toHaveLength(0);
    const r = await svc.runMorningNotices(db, true, "2026-11-21T08:40:00Z");
    expect(r.stores).toBe(1);
    expect(r.sent).toBe(2);
    const m = sent[0].body;
    expect(m.title).toContain("ATENA 今日の出勤");
    expect(m.body).toContain("出勤");
    expect(m.body).toContain("山田");
    expect(m.body).toMatch(/休み（1人）：山田/);
    expect(m.url).toBe("/shifts");
    sent.length = 0;
    expect(await svc.runMorningNotices(db, true, "2026-11-21T09:00:00Z")).toEqual({ stores: 0, sent: 0 });   // 同じ日の2回目は送らない
  });
});
