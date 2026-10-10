import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { aiStatus, callAi } from "../lib/ai";
import { discussionPrompt, minutesPrompt, parseMindmap } from "../lib/meeting-prompts";

describe("ミーティングの指示文・マインドマップの読み取り・AIの呼び出し", () => {
  it("AI会議の指示は、ユーザーの文章のまま、テーマだけが入れかわる", () => {
    const p = discussionPrompt("新人の定着率を上げるには");
    expect(p).toContain("STEP1:新人の定着率を上げるにはを設定");
    expect(p).toContain("STEP3:新人の定着率を上げるにはについて5回会話してください。");
    expect(p).toContain("STEP3の各人格の発言は全文記載すること");
    expect(p).toContain("議論のテーマは{新人の定着率を上げるには}でお願いします");
  });
  it("議事録の指示に、会議名・文字起こしが入る。長すぎる文字起こしは切る", () => {
    expect(minutesPrompt("これは本文", "朝礼", "2026-10-05", "A, B")).toContain("会議名：朝礼");
    expect(minutesPrompt("あ".repeat(70000)).length).toBeLessThan(65000);
  });
  it("マインドマップは、前後に説明や ``` があっても読める。深さ・数に上限", () => {
    const t = parseMindmap('はい、こちらです\n```json\n{"title":"朝礼","children":[{"title":"課題","children":[{"title":"遅刻","children":[{"title":"深すぎる","children":[]}]}]}]}\n```');
    expect(t?.title).toBe("朝礼");
    expect(t?.children[0].children[0].title).toBe("遅刻");
    expect(t?.children[0].children[0].children).toHaveLength(0);          // 深さは3段まで
    expect(parseMindmap("JSONではありません")).toBeNull();
    expect(parseMindmap('{"title":"x","children":[{"title":""}]}')?.children).toHaveLength(0);
  });
  it("カギが無ければ使えない。あれば、決まった先に送る", async () => {
    expect(aiStatus({})).toEqual({ available: false, provider: null });
    await expect(callAi("こんにちは", { env: {} })).rejects.toThrow("AIの準備");
    let sent: { url: string; key: string | null } | null = null;
    const fake = (async (url: string, init: RequestInit) => { sent = { url, key: new Headers(init.headers).get("x-goog-api-key") }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "答え" }] } }] }), { status: 200 }); }) as unknown as typeof fetch;
    expect(await callAi("質問", { env: { GEMINI_API_KEY: "k1" }, fetchFn: fake })).toBe("答え");
    expect(sent).toMatchObject({ key: "k1" });
    const busy = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(callAi("質問", { env: { GEMINI_API_KEY: "k1" }, fetchFn: busy })).rejects.toThrow("利用回数が");
  });
});

describe("会議の保存と、見られる人・書ける人", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {}; let mid = "";
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('mt-co','M') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string) => (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
    await mk("office", "1", 4, sid.a); await mk("mgrA", "2", 3, sid.a); await mk("mgrB", "3", 3, sid.b); await mk("sA", "4", 1, sid.a); await mk("sB", "5", 1, sid.b);
  });
  it("店長が作れる。スタッフ・他店の店長は作れない", async () => {
    await expect(svc.createMeeting(d, u.sA, { storeId: sid.a, title: "朝礼", heldOn: "2026-10-05" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.createMeeting(d, u.mgrB, { storeId: sid.a, title: "朝礼", heldOn: "2026-10-05" })).rejects.toThrow(svc.ForbiddenError);
    mid = await svc.createMeeting(d, u.mgrA, { storeId: sid.a, title: "朝礼", heldOn: "2026-10-05", attendees: "A, B" });
    await svc.updateMeeting(d, u.mgrA, mid, { transcript: "今日は新人の教育について話しました。" });
    await expect(svc.updateMeeting(d, u.sA, mid, { transcript: "書きかえ" })).rejects.toThrow(svc.ForbiddenError);
  });
  it("自店のスタッフは見られる（直せない）。他店のスタッフ・店長は見えない。正美さんは全店", async () => {
    expect((await svc.listMeetings(d, u.sA, sid.a)).map((m) => m.title)).toEqual(["朝礼"]);
    expect((await svc.getMeeting(d, u.sA, mid))?.canEdit).toBe(false);
    expect((await svc.getMeeting(d, u.mgrA, mid))?.canEdit).toBe(true);
    expect(await svc.listMeetings(d, u.sB, sid.a)).toHaveLength(0);
    expect(await svc.getMeeting(d, u.mgrB, mid)).toBeNull();
    expect((await svc.listMeetings(d, u.office, sid.a))).toHaveLength(1);
  });
  it("AIで議事録・要約・マインドマップ・AI会議をつくって保存する（書ける人だけ）", async () => {
    const calls: string[] = [];
    const fake = async (p: string) => { calls.push(p); return p.includes("JSONだけ") ? '{"title":"朝礼","children":[{"title":"教育","children":[]}]}' : "AIの答え"; };
    await expect(svc.runMeetingAi(d, u.sA, { id: mid, action: "minutes" }, fake)).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.runMeetingAi(d, u.mgrA, { id: mid, action: "minutes" }, fake)).text).toBe("AIの答え");
    await svc.runMeetingAi(d, u.mgrA, { id: mid, action: "summary" }, fake);
    await svc.runMeetingAi(d, u.mgrA, { id: mid, action: "mindmap" }, fake);
    const r = await svc.runMeetingAi(d, u.mgrA, { id: mid, action: "discussion", theme: "新人の教育" }, fake);
    expect(r.text).toBe("AIの答え");
    expect(calls[calls.length - 1]).toContain("STEP2:新人の教育に関する議論");
    const g = (await svc.getMeeting(d, u.mgrA, mid))!;
    expect(g.meeting).toMatchObject({ minutes: "AIの答え", summary: "AIの答え" });
    expect(JSON.parse(g.meeting.mindmap).title).toBe("朝礼");
    expect(g.ai[0]).toMatchObject({ theme: "新人の教育", result: "AIの答え" });
    expect((await svc.getMeeting(d, u.sA, mid))?.ai).toHaveLength(1);      // 自店のスタッフは、AI会議の結果も読める
  });
  it("削除は消さずに隠す", async () => {
    await expect(svc.deleteMeeting(d, u.sA, mid)).rejects.toThrow(svc.ForbiddenError);
    await svc.deleteMeeting(d, u.mgrA, mid);
    expect(await svc.listMeetings(d, u.mgrA, sid.a)).toHaveLength(0);
    expect((await d.query("select 1 from meetings where id = $1", [mid])).rows).toHaveLength(1);
  });
});

import { layoutMindmap } from "../lib/mindmap-layout";
describe("マインドマップの並べ方", () => {
  it("中心が左、枝が右。親は子の真ん中。重ならない", () => {
    const l = layoutMindmap({ title: "会議", children: [{ title: "A", children: [{ title: "a1", children: [] }, { title: "a2", children: [] }] }, { title: "B", children: [] }] });
    const by = (t: string) => l.nodes.find((n) => n.title === t)!;
    expect(by("会議").x).toBeLessThan(by("A").x);
    expect(by("A").x).toBeLessThan(by("a1").x);
    expect(by("A").y).toBe((by("a1").y + by("a2").y) / 2);
    const ys = [by("a1").y, by("a2").y, by("B").y]; expect(new Set(ys).size).toBe(3);
    expect(l.edges).toHaveLength(4);
  });
});

describe("スタイリストミーティング・アシスタントミーティング", () => {
  let d: Database; const id: Record<string, string> = {}; let A: string; let B: string;
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('k-co','K') returning id")).rows[0].id;
    A = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A店') returning id", [co])).rows[0].id;
    B = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'B店') returning id", [co])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string, rank: string | null) =>
      (id[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level, rank) values ($1,$2,$3,$4,$5,$6) returning id", [co, s, code, k, level, rank])).rows[0].id);
    await mk("office", "1", 4, A, null); await mk("mgr", "2", 3, A, "stylist");
    await mk("sty", "3", 1, A, "stylist"); await mk("asi", "4", 1, A, "assistant"); await mk("styB", "5", 1, B, "stylist");
  });
  it("スタイリストのミーティングは、スタイリスト・店長・正美さんだけが見られる。アシスタント・他店は見えない", async () => {
    const mid = await svc.createMeeting(d, id.sty, { storeId: A, title: "スタイリスト会", heldOn: "2026-10-10", kind: "stylist", agenda: "売上の話" });
    expect((await svc.listMeetings(d, id.sty, A, "stylist")).map((m) => m.title)).toEqual(["スタイリスト会"]);
    expect((await svc.listMeetings(d, id.mgr, A, "stylist")).length).toBe(1);
    expect((await svc.listMeetings(d, id.office, A, "stylist")).length).toBe(1);
    expect(await svc.listMeetings(d, id.asi, A, "stylist")).toEqual([]);
    expect(await svc.listMeetings(d, id.styB, A, "stylist")).toEqual([]);
    expect(await svc.getMeeting(d, id.asi, mid)).toBeNull();
    await expect(svc.createMeeting(d, id.asi, { storeId: A, title: "x", heldOn: "2026-10-10", kind: "stylist" })).rejects.toThrow(svc.ForbiddenError);
  });
  it("アシスタントのミーティング: スタイリストが議題を決める。アシスタントは見られて、記録は書けるが、議題は書けない", async () => {
    const mid = await svc.createMeeting(d, id.sty, { storeId: A, title: "アシスタント会", heldOn: "2026-10-11", kind: "assistant", agenda: "シャンプーの練習" });
    const g = (await svc.getMeeting(d, id.asi, mid))!;
    expect(g.meeting.agenda).toBe("シャンプーの練習");
    expect([g.canEdit, g.canAgenda]).toEqual([true, false]);
    await svc.updateMeeting(d, id.asi, mid, { transcript: "話した内容" });                       // アシスタントも記録は書ける
    await expect(svc.updateMeeting(d, id.asi, mid, { agenda: "書きかえ" })).rejects.toThrow();     // 議題は書けない
    await svc.updateMeeting(d, id.sty, mid, { agenda: "シャンプーと接客" });
    expect((await svc.getMeeting(d, id.asi, mid))!.meeting.agenda).toBe("シャンプーと接客");
    await expect(svc.createMeeting(d, id.asi, { storeId: A, title: "x", heldOn: "2026-10-10", kind: "assistant" })).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.listMeetings(d, id.styB, A, "assistant")).toEqual([]);                      // 他店は見えない
  });
  it("ふつうの会議は、今までどおり（書けるのは店長・正美さんたち）", async () => {
    await expect(svc.createMeeting(d, id.sty, { storeId: A, title: "x", heldOn: "2026-10-10" })).rejects.toThrow(svc.ForbiddenError);
    await svc.createMeeting(d, id.mgr, { storeId: A, title: "ふつう", heldOn: "2026-10-10" });
    expect((await svc.listMeetings(d, id.asi, A)).length).toBe(1);
  });
});
