import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { localAnswer, pickTopics, topicsFor } from "../lib/assistant";

let db: Database; let staff = "", boss = "";
beforeAll(async () => {
  db = await newDb(); await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('as-co','A') returning id")).rows[0].id;
  const st = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A店') returning id", [co])).rows[0].id;
  staff = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'1','山田',1) returning id", [co, st])).rows[0].id;
  boss = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'2','店長',3) returning id", [co, st])).rows[0].id;
});

describe("右下のアシスタント", () => {
  it("質問に近い説明を選ぶ。使えない機能は出ない", () => {
    const me1 = { level: 1, materialManager: false, eduLead: false } as never;
    const t = pickTopics("パスコードを変えたい", topicsFor(me1));
    expect(t.length).toBeGreaterThan(0);
    expect(t[0].title).toMatch(/パスコード|ログイン/);
    expect(topicsFor(me1).some((x) => (x.min ?? 1) > 1)).toBe(false);
    expect(pickTopics("", topicsFor(me1))).toEqual([]);
  });
  it("AIが使えないときは、近い説明をそのまま返す（保存しない）", async () => {
    const r = await svc.askAssistant(db, staff, { question: "パスコードを変えたい" });
    expect(r.ai).toBe(false);
    expect(r.answer).toMatch(/1\./);
    expect(localAnswer("ぜんぜん関係ない ??", [])).toMatch(/見つかりませんでした/);
  });
  it("AIが使えるときは、使える機能の説明を渡して答えをもらう。AIが失敗したら、近い説明を出す", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12";
    try {
      let sys = "";
      const r = await svc.askAssistant(db, staff, { question: "休みを出したい" }, async (s) => { sys = s; return "1. 「休み」を押します"; });
      expect(r).toEqual({ answer: "1. 「休み」を押します", ai: true });
      expect(sys).toMatch(/やさしい日本語/);
      expect(sys).not.toMatch(/正美さん用の設定/);
      const r2 = await svc.askAssistant(db, boss, { question: "休みを出したい" }, async () => { throw new Error("busy"); });
      expect(r2.ai).toBe(false);
      expect(r2.answer).toMatch(/AIがつかれています/);
      await expect(svc.askAssistant(db, staff, { question: "  " })).rejects.toThrow("聞きたいこと");
    } finally { delete process.env.GEMINI_API_KEY; }
  });
});
