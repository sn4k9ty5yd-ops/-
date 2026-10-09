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
