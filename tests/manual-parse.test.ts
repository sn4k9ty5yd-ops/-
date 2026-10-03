import { describe, expect, it } from "vitest";
import { parseEnhancedMarkdown } from "../lib/manual/enhanced-markdown";
import { collectSources, plainText } from "../lib/manual/blocks";

describe("Notion拡張マークダウン → マニュアルのブロック", () => {
  it("トグルの入れ子と動画", () => {
    const b = parseEnhancedMarkdown(`# 教育動画🎥 {color="red"}
<details>
<summary>カット</summary>
\t<details>
\t<summary>シザーの基礎</summary>
\t\t<details>
\t\t<summary>シザーの正しい持ち方</summary>
\t\t\t<video src="https://youtu.be/o90kXkjNHRo"></video>
\t\t</details>
\t</details>
</details>
<empty-block/>
[https://youtu.be/i4MVp8qhMIo](https://youtu.be/i4MVp8qhMIo)`);
    expect(b[0]).toMatchObject({ t: "h", l: 1, x: "教育動画🎥", color: "red" });
    const cut = b[1] as Extract<(typeof b)[number], { t: "toggle" }>;
    expect(cut.x).toBe("カット");
    const sub = cut.children[0] as typeof cut;
    expect(sub.children[0]).toMatchObject({ t: "toggle", x: "シザーの正しい持ち方" });
    expect(((sub.children[0] as typeof cut).children[0])).toEqual({ t: "video", url: "https://youtu.be/o90kXkjNHRo" });
    expect(b[2]).toMatchObject({ t: "p" });
  });
  it("コールアウト・列・表・画像・リスト・データベース", () => {
    const b = parseEnhancedMarkdown(`<callout icon="💡" color="gray_bg">
\tルールや空き時間の使い方
</callout>
<columns>
\t<column ratio="50">
\t\t### ① テーマ {color="blue"}
\t</column>
\t<column ratio="50">
\t\t- 一覧
\t\t\t- 子
\t</column>
</columns>
<table header-row="true">
<tr>
<td>名前</td>
<td>点</td>
</tr>
<tr>
<td>A</td>
<td>20</td>
</tr>
</table>
![図](https://example.com/a.png?x=1&amp;y=2#notion_record=block.1)
<database url="https://app.notion.com/p/abc" inline="true" data-source-url="collection://x">教育マニュアル</database>
<page url="https://app.notion.com/p/def">帰りのチェック表</page>
1. 一つ目
- [x] 済み`);
    expect(b[0]).toMatchObject({ t: "callout", icon: "💡", children: [{ t: "p", x: "ルールや空き時間の使い方" }] });
    expect(b[1]).toMatchObject({ t: "cols" });
    const cols = (b[1] as { cols: unknown[][] }).cols;
    expect(cols[0][0]).toMatchObject({ t: "h", l: 3, x: "① テーマ", color: "blue" });
    expect(cols[1][0]).toMatchObject({ t: "ul", x: "一覧", children: [{ t: "ul", x: "子" }] });
    expect(b[2]).toEqual({ t: "table", header: true, rows: [["名前", "点"], ["A", "20"]] });
    expect(b[3]).toEqual({ t: "img", src: "https://example.com/a.png?x=1&y=2", cap: "図" });
    expect(b[4]).toMatchObject({ t: "db", title: "教育マニュアル" });
    expect(b[5]).toMatchObject({ t: "child", title: "帰りのチェック表" });
    expect(b[6]).toMatchObject({ t: "ol", x: "一つ目" });
    expect(b[7]).toMatchObject({ t: "todo", checked: true });
    expect(collectSources(b)).toEqual([{ src: "https://example.com/a.png?x=1&y=2", kind: "img" }]);
    expect(plainText(b)).toContain("帰りのチェック表".slice(0, 0));
  });
});
