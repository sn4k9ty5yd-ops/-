import { describe, expect, it } from "vitest";
import { collectExternal, isExternal, isYouTube } from "../lib/manual/links";
import type { Block } from "../lib/manual/blocks";

describe("マニュアルの外部リンク", () => {
  it("YouTubeは外部リンクに入れない。ほかのサイトは入れる", () => {
    expect(isYouTube("https://youtu.be/abcdefghijk")).toBe(true);
    expect(isExternal("https://www.youtube.com/watch?v=abcdefghijk")).toBe(false);
    expect(isExternal("https://drive.google.com/file/d/1/view")).toBe(true);
    expect(isExternal("/manual/abc")).toBe(false);
  });
  it("リンク・動画・ファイル・文章の中のリンクを集め、同じアドレスは1つにする。マニュアルの中のNotionページは入れない", () => {
    const key = "0123456789abcdef0123456789abcdef";
    const blocks: Block[] = [
      { t: "link", url: "https://example.com/a", x: "資料A" },
      { t: "video", url: "https://youtu.be/abcdefghijk" },
      { t: "video", url: "https://vimeo.com/123" },
      { t: "file", src: "https://files.example.com/x.pdf", name: "手順書" },
      { t: "p", x: "詳しくは [こちら](https://example.com/a) と [中のページ](https://www.notion.so/" + key + ") と [別](https://example.org/b)" },
      { t: "toggle", x: "開く", children: [{ t: "link", url: "https://example.net/c", x: "" }] },
    ];
    const r = collectExternal(blocks, new Set([key]));
    expect(r.map((x) => x.url)).toEqual(["https://example.com/a", "https://vimeo.com/123", "https://files.example.com/x.pdf", "https://example.org/b", "https://example.net/c"]);
    expect(r.find((x) => x.url.endsWith("/x.pdf"))?.kind).toBe("file");
  });
});

import { BUNDLED_SETS, mergeBundled } from "../lib/manual/bundled";
describe("同梱の資料（アキバ塾のPDF）", () => {
  const set = BUNDLED_SETS[0];
  const refs = Object.fromEntries(set.files.map((f) => [f.file, "asset:" + f.file]));
  it("「教科書」の中の、各回の文章の下に入れる。2回目をやっても増えない", () => {
    const body: Block[] = [{ t: "toggle", x: "📕各種教科書", children: [{ t: "p", x: "１回目授業" }, { t: "p", x: "２回目授業" }, { t: "p", x: "３回目授業" }] }];
    const a = mergeBundled(body, set, refs);
    expect(a.added).toBe(6);
    const kids = (a.body[0] as Extract<Block, { t: "toggle" }>).children;
    expect(kids.slice(0, 4).map((b) => b.t)).toEqual(["p", "file", "p", "file"]);
    expect(mergeBundled(a.body, set, refs).added).toBe(0);
  });
  it("見つからなければページの終わりに足す", () => {
    expect(mergeBundled([], set, refs).body.length).toBe(6);
  });
});

import { groupSection } from "../lib/manual/bundled";
import { applyOp } from "../lib/manual/edit";
describe("あきば塾のまとめ・タップ表", () => {
  it("見出しから後ろを、ひとつの項目にまとめ、📕・🎥はその中の項目にする。2回目は何もしない", () => {
    const body: Block[] = [
      { t: "h", l: 1, x: "教育動画🎥" }, { t: "toggle", x: "カット", children: [] },
      { t: "h", l: 1, x: "あきば塾🏫" }, { t: "p", x: "📕各種教科書" }, { t: "p", x: "１回目授業" }, { t: "p", x: "🎥動画" }, { t: "video", url: "https://youtu.be/abcdefghijk" },
    ];
    const g = groupSection(body, "アキバ塾");
    expect(g.grouped).toBe(true);
    expect(g.body.map((b) => b.t)).toEqual(["h", "toggle", "toggle"]);
    const t = g.body[2] as Extract<Block, { t: "toggle" }>;
    expect(t.children.map((b) => b.t)).toEqual(["toggle", "toggle"]);
    expect(groupSection(g.body, "あきば塾").grouped).toBe(false);
  });
  it("タップ表は ✓ か空だけ。見出しの行・日付の列は押せない", () => {
    const body: Block[] = [{ t: "table", header: true, tap: true, edit: true, id: "t1", rows: [["日付", "ボイラー"], ["1日", ""]] }];
    const a = applyOp(body, { op: "cell", id: "t1", r: 1, c: 1, text: "✓" });
    expect((a.body[0] as Extract<Block, { t: "table" }>).rows[1][1]).toBe("✓");
    expect(() => applyOp(body, { op: "cell", id: "t1", r: 1, c: 1, text: "あ" })).toThrow();
    expect(() => applyOp(body, { op: "cell", id: "t1", r: 0, c: 1, text: "✓" })).toThrow();
    expect(() => applyOp(body, { op: "cell", id: "t1", r: 1, c: 0, text: "✓" })).toThrow();
  });
});
