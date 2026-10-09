import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { statsFor, trend } from "../lib/lesson-summary";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};
let cats: svc.LessonCategory[] = [];

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('l-co','L') returning id")).rows[0].id;
  for (const n of ["A店", "B店"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string, name: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
  await mk("office", "1", 4, st["A店"], "事務員"); await db.query("update memberships set app_owner = true where id = $1", [id.office]);   // レッスンの状況を見られるのは、制作者と社長だけ（正美さんは見られない）
  await mk("mgr", "2", 3, st["A店"], "店長"); await mk("edu", "3", 1, st["A店"], "教育 担当");
  await mk("a1", "4", 1, st["A店"], "アシ 一子"); await mk("a2", "5", 1, st["A店"], "アシ 二子"); await mk("plain", "6", 1, st["A店"], "ふつう");
  await mk("b1", "7", 1, st["B店"], "他店 アシ"); await mk("mgrB", "8", 3, st["B店"], "B店長");
  for (const k of ["a1", "a2", "b1"]) await svc.setRank(db, id.office, id[k], "assistant");
  await svc.setEduLead(db, id.mgr, id.edu, true);
});

describe("レッスン記録", () => {
  it("初期のボタンが自動でできる（カットモデル・ウィッグカット・カラー・パーマ・髪質改善・シャンプー）", async () => {
    const flat = await svc.listLessonCategories(db, id.edu, st["A店"]);
    cats = flat.filter((c) => !c.parentId);
    expect(cats.map((c) => c.name)).toEqual(["カットモデル", "ウィッグカット", "カラー", "パーマ", "髪質改善", "シャンプー"]);
    const kids = (parent: string) => flat.filter((c) => c.parentId === cats.find((x) => x.name === parent)!.id).map((c) => c.name);
    expect(kids("ウィッグカット")).toEqual(["ワンレングス", "グラデーション", "レイヤー"]);
    expect(kids("カラー")).toEqual(["ファッションカラー", "グレイカラー（リタッチ）"]);
  });

  it("小さなボタン: 記録は「ウィッグカット・レイヤー」と出て、何人目は小さなボタンごとに数える。ボタンの中のボタンは1段まで", async () => {
    const flat = await svc.listLessonCategories(db, id.edu, st["A店"]);
    const wig = cats.find((c) => c.name === "ウィッグカット")!;
    const layer = flat.find((c) => c.parentId === wig.id && c.name === "レイヤー")!;
    const one = flat.find((c) => c.parentId === wig.id && c.name === "ワンレングス")!;
    expect((await svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a2, categoryId: layer.id, day: "2026-09-10", minutes: 40 })).ordinal).toBe(1);
    expect((await svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a2, categoryId: layer.id, day: "2026-09-11" })).ordinal).toBe(2);
    expect((await svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a2, categoryId: one.id, day: "2026-09-12" })).ordinal).toBe(1);
    const rows = await svc.listLessons(db, id.a2, { from: "2026-09-01", to: "2026-09-30", assistantId: id.a2 });
    expect(rows.map((r) => `${r.category}${r.ordinal}`).sort()).toEqual(["ウィッグカット・レイヤー1", "ウィッグカット・レイヤー2", "ウィッグカット・ワンレングス1"]);
    expect(rows[0].leaf).toMatch(/レイヤー|ワンレングス/);
    await svc.saveLessonCategory(db, id.edu, st["A店"], { name: "ブリーチ", parentId: cats.find((c) => c.name === "カラー")!.id });
    expect((await svc.listLessonCategories(db, id.edu, st["A店"])).some((c) => c.name === "ブリーチ")).toBe(true);
    await expect(svc.saveLessonCategory(db, id.edu, st["A店"], { name: "さらに下", parentId: layer.id })).rejects.toThrow("1段");
    await svc.saveLessonCategory(db, id.edu, st["A店"], { name: "ブリーチ", parentId: wig.id });      // 別の親なら、同じ名前でもよい
  });

  it("教育担当(スタッフ権限)が自店のアシスタントの記録を入れられ、何人目かが数えられる。他店・ふつうのスタッフは不可", async () => {
    const cut = cats[0].id, color = cats[2].id;
    expect((await svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a1, categoryId: cut, day: "2026-10-01", minutes: 60 })).ordinal).toBe(1);
    expect((await svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a1, categoryId: cut, day: "2026-10-02", minutes: 45 })).ordinal).toBe(2);
    expect((await svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a1, categoryId: color, day: "2026-10-02" })).ordinal).toBe(1);
    expect((await svc.addLesson(db, id.mgr, st["A店"], { assistantId: id.a2, categoryId: cut, day: "2026-10-02" })).ordinal).toBe(1);   // 店長も
    await expect(svc.addLesson(db, id.plain, st["A店"], { assistantId: id.a1, categoryId: cut, day: "2026-10-03" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addLesson(db, id.edu, st["B店"], { assistantId: id.b1, categoryId: cut, day: "2026-10-03" })).rejects.toThrow(svc.ForbiddenError);   // 他店
    await expect(svc.addLesson(db, id.edu, st["A店"], { assistantId: id.b1, categoryId: cut, day: "2026-10-03" })).rejects.toThrow(svc.ForbiddenError);   // 他店の人を対象にできない
    await expect(svc.addLesson(db, id.edu, st["A店"], { assistantId: id.a1, categoryId: cut, day: "2026-10-03", minutes: 0 })).rejects.toThrow("時間");
  });

  it("見られる範囲: 本人は自分だけ、教育担当・店長は自店、管理者は全店。他店の店長は見られない", async () => {
    const day = { from: "2026-10-01", to: "2026-10-31" };
    expect((await svc.listLessons(db, id.a1, { ...day, assistantId: id.a1 })).map((r) => `${r.category}${r.ordinal}`).sort()).toEqual(["カットモデル1", "カットモデル2", "カラー1"]);
    expect(await svc.listLessons(db, id.a1, { ...day })).toHaveLength(3);                                    // 他の人(a2)の分は見えない
    expect(await svc.listLessons(db, id.edu, { ...day, storeId: st["A店"] })).toHaveLength(4);
    expect(await svc.listLessons(db, id.mgr, { ...day, storeId: st["A店"] })).toHaveLength(4);
    expect(await svc.listLessons(db, id.office, { ...day })).toHaveLength(4);
    expect(await svc.listLessons(db, id.mgrB, { ...day, storeId: st["A店"] })).toHaveLength(0);
    expect(await svc.listLessons(db, id.plain, { ...day })).toHaveLength(0);
    const counts = await svc.lessonCounts(db, id.edu, st["A店"]);
    expect(counts[`${id.a1}|${cats[0].id}`]).toBe(2);
  });

  it("まちがえた記録は取り消せて（消えずに）、本人の画面からも消える。ふつうのスタッフは取り消せない", async () => {
    const r = (await svc.listLessons(db, id.edu, { from: "2026-10-02", to: "2026-10-02", storeId: st["A店"] })).find((x) => x.assistantId === id.a2)!;
    await expect(svc.deleteLesson(db, id.plain, r.id)).rejects.toThrow(svc.ForbiddenError);
    await svc.deleteLesson(db, id.edu, r.id);
    expect(await svc.listLessons(db, id.a2, { from: "2026-10-01", to: "2026-10-31", assistantId: id.a2 })).toHaveLength(0);
    expect(await svc.listLessons(db, id.edu, { from: "2026-10-01", to: "2026-10-31", storeId: st["A店"] })).toHaveLength(3);
    const still = await db.query("select 1 from lesson_logs where id = $1 and deleted_at is not null", [r.id]);
    expect(still.rows).toHaveLength(1);
  });

  it("ボタンの編集: 教育担当・店長ができる（追加・名前変更・しまう・並べ替え）。ふつうのスタッフは不可。同じ名前は不可", async () => {
    await svc.saveLessonCategory(db, id.edu, st["A店"], { name: "ヘアセット" });
    let list = await svc.listLessonCategories(db, id.edu, st["A店"], true);
    const hs = list.find((c) => c.name === "ヘアセット")!;
    await svc.saveLessonCategory(db, id.mgr, st["A店"], { id: hs.id, name: "ヘアセット・着付け" });
    await svc.saveLessonCategory(db, id.edu, st["A店"], { id: hs.id, move: "up" });
    await svc.saveLessonCategory(db, id.edu, st["A店"], { id: cats[5].id, active: false });             // シャンプーをしまう
    list = await svc.listLessonCategories(db, id.edu, st["A店"]);
    expect(list.map((c) => c.name)).not.toContain("シャンプー");
    expect(list.map((c) => c.name)).toContain("ヘアセット・着付け");
    await expect(svc.saveLessonCategory(db, id.edu, st["A店"], { name: "カラー" })).rejects.toThrow("同じ名前");
    await expect(svc.saveLessonCategory(db, id.plain, st["A店"], { name: "x" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.saveLessonCategory(db, id.mgrB, st["A店"], { name: "x" })).rejects.toThrow(svc.ForbiddenError);
  });

  it("教育担当を決められるのは、店長(自店)と管理者だけ", async () => {
    await expect(svc.setEduLead(db, id.mgrB, id.a1, true)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setEduLead(db, id.edu, id.a1, true)).rejects.toThrow(svc.ForbiddenError);
    await svc.setEduLead(db, id.office, id.a1, true);
    expect((await svc.getMe(db, id.a1))?.eduLead).toBe(true);
    await svc.setEduLead(db, id.office, id.a1, false);
  });

  it("集計: 回数・平均時間・最近の変化", () => {
    const mk = (n: number, day: string, min: number | null) => ({ id: String(n), storeId: "s", assistantId: "a", assistantName: "a", categoryId: "c", category: "カット", leaf: "カット", day, minutes: min, note: "", ordinal: n, byName: null, createdAt: `${day}T00:00:00Z` });
    const rows = [60, 60, 60, 60, 60, 60, 90, 90, 90, 90, 90].map((m, i) => mk(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`, m));
    const s = statsFor(rows, "2026-10")[0];
    expect(s).toMatchObject({ total: 11, month: 11, lastOrdinal: 11 });
    expect(s.avgMin).toBe(74);
    expect(s.recentAvg).toBe(90);
    expect(trend(s)).toBe("slower");
  });
});
