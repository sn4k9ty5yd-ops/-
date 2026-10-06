import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { FORTUNE_KINDS, fortunePrompt } from "../lib/fortune-ai";

describe("くわしい占い（四柱推命・六星占術・動物占い）", () => {
  it("指示文は、決めた文章のまま。自分の情報が前に付く", () => {
    const p = fortunePrompt({ kind: "shichu", birth: "1990-05-03", time: "14:30", place: "福岡県", today: "2026-10-06" });
    expect(p).toContain("生年月日：1990年5月3日");
    expect(p).toContain("出生時間：14:30");
    expect(p).toContain("出生地：福岡県");
    expect(p).toContain("あなたは四柱推命の専門家です。");
    expect(p).toContain("専門用語を使う場合は、必ず小学生にも分かる言葉に言い換えてください。");
    expect(fortunePrompt({ kind: "shichu", birth: "1990-05-03", today: "2026-10-06" })).toContain("出生時間：わかりません");
    const r = fortunePrompt({ kind: "rokusei", birth: "1990-05-03", time: "14:30", today: "2026-10-06" });
    expect(r).toContain("あなたは六星占術の専門家です。"); expect(r).not.toContain("出生時間");
    expect(fortunePrompt({ kind: "animal", birth: "1990-05-03", today: "2026-10-06" })).toContain("このタイプが人生で成功するための3つの行動");
    expect(FORTUNE_KINDS.map((k) => k.id)).toEqual(["shichu", "rokusei", "animal"]);
  });
  it("おかしな入力は断る", () => {
    expect(() => fortunePrompt({ kind: "animal", birth: "abc", today: "2026-10-06" })).toThrow("生年月日");
    expect(() => fortunePrompt({ kind: "animal", birth: "2999-01-01", today: "2026-10-06" })).toThrow("生年月日");
    expect(() => fortunePrompt({ kind: "x" as never, birth: "1990-05-03", today: "2026-10-06" })).toThrow("種類");
  });
  describe("サービス", () => {
    let d: Database; let u = "";
    beforeAll(async () => {
      d = await newDb(); await migrate(d);
      const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('fz-co','T') returning id")).rows[0].id;
      const sid = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A') returning id", [co])).rows[0].id;
      u = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'1','a',1) returning id", [co, sid])).rows[0].id;
    });
    it("AIに、生年月日つきの指示文が渡り、結果が返る。1時間8回まで", async () => {
      let got = "";
      const r = await svc.runFortuneAi(d, u, { kind: "animal", birth: "1990-05-03" }, async (p) => { got = p; return "あなたは「こじか」です"; });
      expect(r.text).toContain("こじか"); expect(got).toContain("1990年5月3日");
      for (let i = 0; i < 7; i++) await svc.runFortuneAi(d, u, { kind: "rokusei", birth: "1990-05-03" }, async () => "x");
      await expect(svc.runFortuneAi(d, u, { kind: "rokusei", birth: "1990-05-03" }, async () => "x")).rejects.toThrow("使いすぎ");
    });
  });
});
