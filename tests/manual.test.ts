import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import type { Block } from "../lib/manual/blocks";

let db: Database;
const id: Record<string, string> = {};
const page: Record<string, string> = {};
let storeA = "", storeB = "", co = "";

async function person(code: string, name: string, level: number, store: string, evaluate = false) {
  return (await db.query<{ id: string }>(
    "insert into memberships (company_id, store_id, employee_code, name, level, can_evaluate) values ($1,$2,$3,$4,$5,$6) returning id", [co, store, code, name, level, evaluate])).rows[0].id;
}
async function addPage(key: string, p: { title: string; body?: Block[]; minLevel?: number; editLevel?: number; storeId?: string | null; ownerId?: string | null; evaluatorsEdit?: boolean; parent?: string }) {
  page[key] = (await db.query<{ id: string }>(
    `insert into manual_pages (company_id, title, body, min_level, edit_level, store_id, owner_id, evaluators_edit, parent_id) values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) returning id`,
    [co, p.title, JSON.stringify(p.body ?? []), p.minLevel ?? 1, p.editLevel ?? 4, p.storeId ?? null, p.ownerId ?? null, p.evaluatorsEdit ?? false, p.parent ? page[p.parent] : null])).rows[0].id;
}

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  co = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-a','A社') returning id")).rows[0].id;
  storeA = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'店A') returning id", [co])).rows[0].id;
  storeB = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'店B') returning id", [co])).rows[0].id;
  id.admin = await person("1", "管理者", 4, storeA);
  id.mgrA = await person("2", "店長A", 3, storeA);
  id.stylistA = await person("3", "スタイリストA", 1, storeA, true);
  id.assistA = await person("4", "アシスタントA", 1, storeA);
  id.assistB = await person("5", "アシスタントB", 1, storeB);
  id.mgrB = await person("6", "店長B", 3, storeB);
  const sheet: Block[] = [
    { t: "todo", id: "chk1", x: "シャンプー", checked: false },
    { t: "table", id: "tbl1", edit: true, header: true, choices: [null, ["1", "2", "3", "4", "5"]], rows: [["項目", "1回目"], ["流れ", ""]] },
  ];
  await addPage("all", { title: "企業理念", body: [{ t: "p", x: "全員向け" }] });
  await addPage("admin", { title: "売上", minLevel: 4 });
  await addPage("sheetA", { title: "２６年 アシスタントA", body: sheet, minLevel: 3, storeId: storeA, ownerId: id.assistA, evaluatorsEdit: true });
  await addPage("child", { title: "子ページ", parent: "all" });
});

describe("マニュアルの見られる人", () => {
  it("全員向けは誰でも・管理者専用は管理者だけ", async () => {
    expect((await svc.listManualPages(db, id.assistB)).map((p) => p.title).sort()).toEqual(["企業理念", "子ページ"]);
    expect((await svc.listManualPages(db, id.admin)).length).toBe(4);
    await expect(svc.getManualPage(db, id.mgrA, page.admin)).rejects.toThrow();
  });
  it("個人ページは、本人と同じお店の店長以上・管理者だけ（他店のスタッフは見えない。店長は他店も見られる）", async () => {
    expect((await svc.getManualPage(db, id.assistA, page.sheetA)).title).toBe("２６年 アシスタントA");   // 本人
    expect((await svc.getManualPage(db, id.mgrA, page.sheetA)).canEdit).toBe(false);
    expect((await svc.getManualPage(db, id.mgrB, page.sheetA)).title).toBeTruthy();                         // 店長は他店も見られる
    await expect(svc.getManualPage(db, id.assistB, page.sheetA)).rejects.toThrow();                          // 他店のスタッフ
    await expect(svc.getManualPage(db, id.stylistA, page.sheetA)).rejects.toThrow();                         // 同じお店でも、レベルが足りず本人でもない
  });
  it("お店の表示専用アカウントは見られない", async () => {
    const d = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level, on_shift, display_only) values ($1,$2,'iPad','iPad',1,false,true) returning id", [co, storeA])).rows[0].id;
    expect(await svc.listManualPages(db, d)).toHaveLength(0);
  });
});

describe("書き込み（技術評価）", () => {
  it("管理者は書ける。店長は、書き込みレベルが足りないので書けない", async () => {
    await svc.editManualBlock(db, id.admin, page.sheetA, { op: "todo", id: "chk1", checked: true });
    await expect(svc.editManualBlock(db, id.mgrA, page.sheetA, { op: "todo", id: "chk1", checked: false })).rejects.toThrow(svc.ForbiddenError);
    const p = await svc.getManualPage(db, id.admin, page.sheetA);
    expect((p.body[0] as { checked: boolean }).checked).toBe(true);
    expect(p.log[0].summary).toContain("シャンプー");
  });
  it("評価をつけられる人は、見られるページで書ける。選べる値以外は断る", async () => {
    // スタイリストAはレベル1・本人でもないので見られない → 書けない
    await expect(svc.editManualBlock(db, id.stylistA, page.sheetA, { op: "cell", id: "tbl1", r: 1, c: 1, text: "4" })).rejects.toThrow();
    // 見られるようにすると（個人ページを同じお店のレベル1にも見せる）書ける
    await svc.updateManualPage(db, id.admin, page.sheetA, { minLevel: 1 });
    await svc.editManualBlock(db, id.stylistA, page.sheetA, { op: "cell", id: "tbl1", r: 1, c: 1, text: "4" });
    await expect(svc.editManualBlock(db, id.stylistA, page.sheetA, { op: "cell", id: "tbl1", r: 1, c: 1, text: "9" })).rejects.toThrow("選べる値");
    const p = await svc.getManualPage(db, id.assistA, page.sheetA);
    expect((p.body[1] as { rows: string[][] }).rows[1][1]).toBe("4");
    expect(p.canEdit).toBe(false);                                                                                // 本人は見るだけ
    await expect(svc.editManualBlock(db, id.assistA, page.sheetA, { op: "cell", id: "tbl1", r: 1, c: 1, text: "5" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.editManualBlock(db, id.assistB, page.sheetA, { op: "cell", id: "tbl1", r: 1, c: 1, text: "5" })).rejects.toThrow();   // 他店
  });
  it("評価をつけられる人の印は、管理者だけが変えられる。外せば書けなくなる", async () => {
    await expect(svc.setCanEvaluate(db, id.mgrA, id.assistA, true)).rejects.toThrow(svc.ForbiddenError);
    await svc.setCanEvaluate(db, id.admin, id.stylistA, false);
    await expect(svc.editManualBlock(db, id.stylistA, page.sheetA, { op: "cell", id: "tbl1", r: 1, c: 1, text: "3" })).rejects.toThrow(svc.ForbiddenError);
    await svc.setCanEvaluate(db, id.admin, id.stylistA, true);
  });
  it("設定（見られる・書ける人）は管理者だけが変えられ、下のページにもまとめて変えられる", async () => {
    await expect(svc.updateManualPage(db, id.mgrA, page.all, { minLevel: 3 })).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.setManualLevelDeep(db, id.admin, page.all, { minLevel: 2, editLevel: 3, evaluatorsEdit: false, storeId: null, viewRanks: [], editRanks: [] })).toBe(2);
    expect((await svc.listManualPages(db, id.assistB)).map((p) => p.title)).not.toContain("子ページ");
    await expect(svc.deleteManualPage(db, id.mgrA, page.child)).rejects.toThrow(svc.ForbiddenError);
  });
});

describe("ランクと名前での権限", () => {
  it("ランクを決められるのは管理者だけ。スタイリストは、評価ページに書ける（アシスタントは書けない）", async () => {
    const stylist = await person("21", "スタイリストC", 1, storeA);
    const assistant = await person("22", "アシスタントC", 1, storeA);
    await expect(svc.setRank(db, id.mgrA, stylist, "stylist")).rejects.toThrow(svc.ForbiddenError);
    await svc.setRank(db, id.admin, stylist, "stylist"); await svc.setRank(db, id.admin, assistant, "assistant");
    await expect(svc.setRank(db, id.admin, stylist, "boss")).rejects.toThrow("ランク");
    const sheet: Block[] = [{ t: "table", id: "t2", edit: true, header: true, rows: [["項目", "1回目"], ["流れ", ""]] }];
    await addPage("rank", { title: "評価ページ", body: sheet, evaluatorsEdit: true });
    await svc.editManualBlock(db, stylist, page.rank, { op: "cell", id: "t2", r: 1, c: 1, text: "3" });
    await expect(svc.editManualBlock(db, assistant, page.rank, { op: "cell", id: "t2", r: 1, c: 1, text: "5" })).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.getManualPage(db, assistant, page.rank)).canEdit).toBe(false);
    // ランクで書き込みを許す
    await svc.updateManualPage(db, id.admin, page.rank, { evaluatorsEdit: false, editRanks: ["assistant"] });
    await expect(svc.editManualBlock(db, stylist, page.rank, { op: "cell", id: "t2", r: 1, c: 1, text: "4" })).rejects.toThrow(svc.ForbiddenError);
    await svc.editManualBlock(db, assistant, page.rank, { op: "cell", id: "t2", r: 1, c: 1, text: "5" });
  });
  it("ランクで見られる／名前で見られる・書ける。外せば元に戻る", async () => {
    const stylist = (await db.query<{ id: string }>("select id from memberships where employee_code = '21'")).rows[0].id;
    const named = (await db.query<{ id: string }>("select id from memberships where employee_code = '22'")).rows[0].id;
    await addPage("secret", { title: "議事録", minLevel: 4 });
    await expect(svc.getManualPage(db, stylist, page.secret)).rejects.toThrow();
    await svc.updateManualPage(db, id.admin, page.secret, { viewRanks: ["stylist"] });
    expect((await svc.getManualPage(db, stylist, page.secret)).canEdit).toBe(false);
    await expect(svc.getManualPage(db, named, page.secret)).rejects.toThrow();
    await expect(svc.setManualGrant(db, id.mgrA, page.secret, named, "view")).rejects.toThrow(svc.ForbiddenError);
    await svc.setManualGrant(db, id.admin, page.secret, named, "view");
    expect((await svc.getManualPage(db, named, page.secret)).canEdit).toBe(false);
    await svc.setManualGrant(db, id.admin, page.secret, named, "edit");
    expect((await svc.getManualPage(db, named, page.secret)).canEdit).toBe(true);
    expect((await svc.getManualPage(db, id.admin, page.secret)).grants).toEqual([{ membershipId: named, name: "アシスタントC", canEdit: true }]);
    expect((await svc.getManualPage(db, named, page.secret)).grants).toBeUndefined();
    await svc.setManualGrant(db, id.admin, page.secret, named, "remove");
    await expect(svc.getManualPage(db, named, page.secret)).rejects.toThrow();
  });
});

describe("取り込み", () => {
  it("同じ画像は1つだけ保存し、場所を入れ替える。同じIDで取り込み直すと更新。本人は名前で決まる", async () => {
    const { importManualPages } = await import("../lib/manual/import");
    const { parseEnhancedMarkdown } = await import("../lib/manual/enhanced-markdown");
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const pages = [
      { sourceId: "a".repeat(32), title: "教育マニュアル", icon: "📚", blocks: parseEnhancedMarkdown("![](https://x.example/1.png?sig=1)\n![](https://x.example/2.png?sig=2)\n- [ ] チェック") },
      { sourceId: "b".repeat(32), parentSourceId: "a".repeat(32), title: "２６年 アシスタントB", blocks: parseEnhancedMarkdown("本文"), ownerName: "アシスタント B", storeName: "店B", minLevel: 3 },
      { sourceId: "c".repeat(32), parentSourceId: "a".repeat(32), title: "だれか", blocks: [], ownerName: "存在しない人" },
    ];
    const opts = { fetchAsset: async () => ({ data: png, mime: "image/png", name: "image.png" }) };
    const rep = await importManualPages(db, co, pages, opts);
    expect(rep).toMatchObject({ created: 3, assets: 2, ownerMatched: 1, ownerUnmatched: ["存在しない人"] });
    expect((await db.query("select count(*)::int as n from manual_assets")).rows[0]).toEqual({ n: 1 });
    const top = (await db.query<{ id: string; body: Block[] }>("select id, body from manual_pages where source_id = $1", ["a".repeat(32)])).rows[0];
    expect((top.body[0] as { src: string }).src).toMatch(/^asset:[0-9a-f-]{36}$/);
    expect((top.body[2] as { id?: string }).id).toBeTruthy();                          // チェックに書き込み用の印がつく
    const asset = await svc.getManualAsset(db, id.assistA, (top.body[0] as { src: string }).src.slice(6));
    expect(asset?.mime).toBe("image/png");
    const b = (await db.query<{ owner_id: string; store_id: string; min_level: number }>("select owner_id, store_id, min_level from manual_pages where source_id = $1", ["b".repeat(32)])).rows[0];
    expect(b).toMatchObject({ owner_id: id.assistB, store_id: storeB, min_level: 3 });
    const again = await importManualPages(db, co, pages, opts);
    expect(again).toMatchObject({ created: 0, updated: 3 });
    expect((await svc.getManualPage(db, id.admin, top.id)).children).toHaveLength(2);
  });
});
