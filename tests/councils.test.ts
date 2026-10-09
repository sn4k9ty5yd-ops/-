import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
let storeA = "", storeB = "", co = "";
const ai = async () => "会議の結果";
async function person(code: string, name: string, level: number, store: string, owner = false) {
  return (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level, app_owner) values ($1,$2,$3,$4,$5,$6) returning id", [co, store, code, name, level, owner])).rows[0].id;
}
beforeAll(async () => {
  db = await newDb(); await migrate(db);
  co = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-c','C社') returning id")).rows[0].id;
  storeA = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A') returning id", [co])).rows[0].id;
  storeB = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'B') returning id", [co])).rows[0].id;
  id.owner = await person("1", "制作者", 4, storeA, true);
  id.office = await person("2", "正美", 4, storeA);
  id.mgrA = await person("3", "店長A", 3, storeA);
  id.staffA = await person("4", "スタッフA", 1, storeA);
  id.mgrB = await person("5", "店長B", 3, storeB);
});

describe("AI会議（議事録とは別）", () => {
  it("店長がひらくと、自店の人は読める。ほかのお店の人は読めない。スタッフはひらけない", async () => {
    await svc.runCouncil(db, id.mgrA, { storeId: storeA, theme: "定着率", private: false }, ai);
    expect((await svc.listCouncils(db, id.staffA, { storeId: storeA })).map((x) => x.theme)).toEqual(["定着率"]);
    expect(await svc.listCouncils(db, id.mgrB, { storeId: storeA })).toHaveLength(0);
    await expect(svc.runCouncil(db, id.staffA, { storeId: storeA, theme: "x" }, ai)).rejects.toThrow();
    await expect(svc.runCouncil(db, id.mgrA, { storeId: storeB, theme: "x" }, ai)).rejects.toThrow();
  });
  it("貼りつけで残せる。テーマが空ならだめ", async () => {
    await svc.runCouncil(db, id.mgrA, { storeId: storeA, theme: "貼る", paste: "他のAIの答え" }, ai);
    await expect(svc.runCouncil(db, id.mgrA, { storeId: storeA, theme: " " }, ai)).rejects.toThrow();
  });
  it("僕専用は、アプリ制作者の本人だけ。正美さん・店長には、ひらくことも読むこともできない", async () => {
    await svc.runCouncil(db, id.owner, { private: true, theme: "秘密の課題" }, ai);
    expect((await svc.listCouncils(db, id.owner, { private: true })).map((x) => x.theme)).toEqual(["秘密の課題"]);
    for (const u of [id.office, id.mgrA, id.staffA]) {
      await expect(svc.listCouncils(db, u, { private: true })).rejects.toThrow();
      await expect(svc.runCouncil(db, u, { private: true, theme: "x" }, ai)).rejects.toThrow();
    }
    // ふつうの一覧にも、僕専用は混ざらない
    for (const u of [id.owner, id.office]) expect((await svc.listCouncils(db, u, { storeId: storeA })).some((x) => x.theme === "秘密の課題")).toBe(false);
    // DBの権限でも読めない
    const { asUser } = await import("../lib/db/user-context");
    expect((await asUser(db, id.office, (q) => q.query("select * from ai_councils where private"))).rows).toHaveLength(0);
  });
  it("消せるのは、自分がひらいた記録だけ", async () => {
    const r = await svc.runCouncil(db, id.mgrA, { storeId: storeA, theme: "消す" }, ai);
    await expect(svc.deleteCouncil(db, id.office, r.id)).rejects.toThrow();
    await svc.deleteCouncil(db, id.mgrA, r.id);
  });
});
