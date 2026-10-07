import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { asUser } from "../lib/db/user-context";
import { exportAll } from "../lib/backup";
import { heavyNote, mentorSystemPrompt, MENTOR_OPENER } from "../lib/mentor";
import { INTERVIEW_TEMPLATES } from "../lib/interview-sheets";
import { NOT_LOGGED } from "../lib/activity";

describe("メンターの指示文", () => {
  it("Mondayの口調の条件が入り、MBTIで関わり方が変わる。重い話の決まりがある", () => {
    const p = mentorSystemPrompt("ENFP", "田中");
    expect(p).toContain("堅苦しい敬語は禁止");
    expect(p).toContain("ちょっと口が悪いけど、結局いちばん味方してくれる親友");
    expect(p).toContain("【この人のMBTI】ENFP");
    expect(p).toContain("話しながら考えるタイプ");
    expect(p).not.toContain("ホットライン");
    expect(p).toContain("信頼できる人");
    expect(mentorSystemPrompt(null, "")).toContain("未入力");
    expect(MENTOR_OPENER).toBe("やっと呼んだか。で、今日は何やらかした？");
  });
  it("重い言葉があると、冗談をやめる念押しがつく", () => {
    expect(heavyNote("もう限界かも")).toContain("冗談と毒舌はやめて");
    expect(heavyNote("今日お客様に褒められた")).toBe("");
  });
  it("面談シートの質問は、Notionのとおり（10月は8問、2月は4問）", () => {
    expect(INTERVIEW_TEMPLATES.find((t) => t.id === "oct")!.questions).toHaveLength(8);
    expect(INTERVIEW_TEMPLATES.find((t) => t.id === "feb")!.questions[0]).toContain("メンタル・人間関係");
  });
  it("メンターと面談は、使ったことも「変更の記録」に残さない", () => {
    expect(NOT_LOGGED.test("/api/mentor")).toBe(true);
    expect(NOT_LOGGED.test("/api/interviews")).toBe(true);
    expect(NOT_LOGGED.test("/api/shifts")).toBe(false);
  });
});

describe("メンターの会話は本人だけ。面談シートは、書いた人と、そのお店の店長だけ", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {};
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('mn-co','M') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string, extra = "") => { u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id; if (extra) await d.query(`update memberships set ${extra} where id = $1`, [u[k]]); };
    await mk("owner", "1", 4, sid.a, "app_owner = true"); await mk("office", "2", 4, sid.a); await mk("boss", "3", 4, sid.a, "exec_view = true");
    await mk("mgrA", "4", 3, sid.a); await mk("mgrB", "5", 3, sid.b); await mk("mentor", "6", 1, sid.a); await mk("kid", "7", 1, sid.a, "rank = 'assistant'"); await mk("other", "8", 1, sid.a);
  });
  const fake = async (_s: string, turns: { role: string; content: string }[]) => `返事(${turns.length})`;
  it("会話は保存され、MBTIがAIに渡る。続きの会話で、これまでの流れが渡る", async () => {
    await svc.setMentorMbti(d, u.kid, "ENFP");
    await expect(svc.setMentorMbti(d, u.kid, "XXXX")).rejects.toThrow();
    let seen = "";
    const spy = async (s: string, t: { role: string; content: string }[]) => { seen = s; return `返事(${t.length})`; };
    const st = await svc.getMentor(d, u.kid);
    const r1 = await svc.sendMentorMessage(d, u.kid, { sessionId: st.sessionId, text: "今日、先輩に怒られた" }, spy as never);
    expect(r1.reply).toBe("返事(3)");
    expect(seen).toContain("ENFP");
    const r2 = await svc.sendMentorMessage(d, u.kid, { sessionId: st.sessionId, text: "どうしたらいい？" }, fake as never);
    expect(r2.reply).toBe("返事(5)");
    const g = await svc.getMentor(d, u.kid, st.sessionId);
    expect(g.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(g.mbti).toBe("ENFP");
  });
  it("ほかの人は、だれも読めない（アプリ制作者・事務員さん・社長・店長も）", async () => {
    for (const k of ["owner", "office", "boss", "mgrA", "mgrB", "mentor", "other"]) {
      const n = (await asUser(d, u[k], (q) => q.query("select 1 from mentor_messages"))).rows.length;
      expect(n, k).toBe(0);
      expect((await asUser(d, u[k], (q) => q.query("select 1 from mentor_profiles"))).rows.length, k).toBe(0);
      expect((await svc.getMentor(d, u[k])).messages, k).toHaveLength(0);
    }
    // 他人の名前で書き込むこともできない
    await expect(asUser(d, u.office, (q) => q.query("insert into mentor_messages (company_id, membership_id, session_id, role, content) select company_id, $1, gen_random_uuid(), 'user', 'x' from memberships where id = $2", [u.kid, u.office]))).rejects.toThrow();
  });
  it("バックアップにも、会話・面談シートは入らない", async () => {
    const all = await exportAll(d);
    expect(Object.keys(all.tables)).not.toContain("mentor_messages");
    expect(Object.keys(all.tables)).not.toContain("interviews");
  });
  it("本人は、自分の相談を消せる", async () => {
    const st = await svc.getMentor(d, u.kid);
    await svc.deleteMentorSession(d, u.kid, st.sessionId);
    expect((await svc.getMentor(d, u.kid, st.sessionId)).messages).toHaveLength(0);
  });

  let iv = "";
  it("面談シート: 自分のお店のスタッフを選んで書き、店長に提出。提出すると直せない", async () => {
    await expect(svc.createInterview(d, u.mentor, { menteeId: u.mgrB, template: "oct", heldOn: "2026-10-05" })).rejects.toThrow();   // 他店の人は選べない
    iv = await svc.createInterview(d, u.mentor, { menteeId: u.kid, template: "oct", heldOn: "2026-10-05" });
    await svc.saveInterview(d, u.mentor, iv, { answers: { "サロンワークや人間関係でストレスに感じることはありませんか？": "先輩との距離" }, memo: "元気だった" });
    const r = await svc.submitInterview(d, u.mentor, iv);
    expect(r.notified).toBe(1);                                                        // 店長(A店)にだけ
    await expect(svc.saveInterview(d, u.mentor, iv, { memo: "あとから直す" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.submitInterview(d, u.mentor, iv)).rejects.toThrow(svc.ForbiddenError);
  });
  it("読めるのは、書いた人と、そのお店の店長だけ（他店の店長・事務員さん・社長・制作者も読めない）", async () => {
    expect((await svc.listInterviews(d, u.mentor)).rows).toHaveLength(1);
    expect((await svc.listInterviews(d, u.mgrA)).rows).toHaveLength(1);
    for (const k of ["mgrB", "office", "boss", "owner", "kid", "other"]) expect((await svc.listInterviews(d, u[k])).rows, k).toHaveLength(0);
    expect((await svc.listNotifications(d, u.mgrA)).items.some((n) => n.title.includes("面談シート"))).toBe(true);
    for (const k of ["office", "boss", "owner"]) expect((await svc.listNotifications(d, u[k])).items.some((n) => n.title.includes("面談シート")), k).toBe(false);
  });
  it("確認できるのは、そのお店の店長だけ。確認すると、書いた人にお知らせ", async () => {
    await expect(svc.reviewInterview(d, u.mgrB, iv, "OK")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reviewInterview(d, u.office, iv, "OK")).rejects.toThrow(svc.ForbiddenError);
    await svc.reviewInterview(d, u.mgrA, iv, "よく聞けています");
    expect((await svc.listInterviews(d, u.mgrA)).rows[0]).toMatchObject({ status: "reviewed", reviewComment: "よく聞けています" });
    expect((await svc.listNotifications(d, u.mentor)).items.some((n) => n.title.includes("店長が確認"))).toBe(true);
  });
});

describe("面談シートの編集・削除", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {};
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('iv-co','I') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string) => (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
    await mk("mgr", "1", 3, sid.a); await mk("mentor", "2", 1, sid.a); await mk("kid1", "3", 1, sid.a); await mk("kid2", "4", 1, sid.a); await mk("far", "5", 1, sid.b);
  });
  it("まちがえた下書きは、受けた人・種類・日付を直せる。他店の人には直せない", async () => {
    const id = await svc.createInterview(d, u.mentor, { menteeId: u.kid1, template: "apr", heldOn: "2026-10-05" });
    await svc.saveInterview(d, u.mentor, id, { menteeId: u.kid2, template: "oct", heldOn: "2026-10-06" });
    expect((await svc.listInterviews(d, u.mentor)).rows[0]).toMatchObject({ menteeId: u.kid2, template: "oct", heldOn: "2026-10-06" });
    await expect(svc.saveInterview(d, u.mentor, id, { menteeId: u.far })).rejects.toThrow();
    await expect(svc.saveInterview(d, u.kid1, id, { template: "feb" })).rejects.toThrow(svc.ForbiddenError);
  });
  it("提出ずみは、取り下げて直せる。確認ずみは動かせない。消せるのは書いた人だけ", async () => {
    const id = await svc.createInterview(d, u.mentor, { menteeId: u.kid1, template: "jun", heldOn: "2026-10-05" });
    await svc.submitInterview(d, u.mentor, id);
    await expect(svc.deleteInterview(d, u.mgr, id)).rejects.toThrow(svc.ForbiddenError);       // 店長でも、消せない
    await expect(svc.reopenInterview(d, u.mgr, id)).rejects.toThrow(svc.ForbiddenError);
    await svc.reopenInterview(d, u.mentor, id);
    await svc.saveInterview(d, u.mentor, id, { memo: "直した" });
    await svc.submitInterview(d, u.mentor, id);
    await svc.reviewInterview(d, u.mgr, id, "OK");
    await expect(svc.deleteInterview(d, u.mentor, id)).rejects.toThrow(svc.ForbiddenError);     // 確認ずみは消せない
    await expect(svc.reopenInterview(d, u.mentor, id)).rejects.toThrow(svc.ForbiddenError);
  });
  it("下書きは、書いた人が消せる", async () => {
    const id = await svc.createInterview(d, u.mentor, { menteeId: u.kid1, template: "feb", heldOn: "2026-10-05" });
    const before = (await svc.listInterviews(d, u.mentor)).rows.length;
    await svc.deleteInterview(d, u.mentor, id);
    expect((await svc.listInterviews(d, u.mentor)).rows).toHaveLength(before - 1);
  });
});

describe("みんなのMBTI（スタイリストは全店・ほかは自分のお店）", () => {
  let d: Database; const u: Record<string, string> = {};
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('mb-co','M') returning id")).rows[0].id;
    const a = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A') returning id", [co])).rows[0].id;
    const b = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'B') returning id", [co])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string, extra = "") => { u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id; if (extra) await d.query(`update memberships set ${extra} where id = $1`, [u[k]]); };
    await mk("styA", "1", 1, a, "rank = 'stylist'"); await mk("styB", "2", 1, b, "rank = 'stylist'"); await mk("kid", "3", 1, a, "rank = 'assistant'"); await mk("mgr", "4", 3, a);
    await svc.setMentorMbti(d, u.kid, "ENFP"); await svc.setMentorMbti(d, u.styB, "ISTJ");
  });
  it("スタイリストは、お店がちがう人のMBTIも見られる。会話は見えない", async () => {
    const r = await svc.listMbtiDirectory(d, u.styA);
    expect(r.map((x) => [x.name, x.mbti]).sort()).toEqual([["kid", "ENFP"], ["styB", "ISTJ"]]);
    expect((await svc.getMentor(d, u.styA)).messages).toHaveLength(0);
  });
  it("スタイリスト以外（アシスタント・店長）は、自分のお店の人だけ見られる", async () => {
    expect((await svc.listMbtiDirectory(d, u.kid)).map((x) => x.name)).toEqual(["kid"]);   // Aの店は kid だけ（B店の styB は見えない）
    expect((await svc.listMbtiDirectory(d, u.mgr)).map((x) => x.name)).toEqual(["kid"]);
  });
});

import { readFileSync } from "node:fs";
describe("マニュアルの空の「◯月面談」ページを消す移行", () => {
  it("題名が「◯月面談」でレベル4以上のものだけ消える。ほかのページは消えない", async () => {
    const d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('mp-co','M') returning id")).rows[0].id;
    const ins = async (title: string, min: number) => (await d.query<{ id: string }>("insert into manual_pages (company_id, title, min_level) values ($1,$2,$3) returning id", [co, title, min])).rows[0].id;
    const parent = await ins("メンター制度", 1);
    await d.query("insert into manual_pages (company_id, parent_id, title, min_level) values ($1,$2,'４月面談',4),($1,$2,'10月面談',4),($1,$2,'２月面談',4),($1,$2,'1月面談だよ',4),($1,$2,'6月面談',1)", [co, parent]);
    await d.query(readFileSync("db/migrations/0054_remove_empty_interview_pages.sql", "utf8"));
    const left = (await d.query<{ title: string }>("select title from manual_pages order by title")).rows.map((r) => r.title);
    expect(left).toEqual(["1月面談だよ", "6月面談", "メンター制度"]);
  });
});
