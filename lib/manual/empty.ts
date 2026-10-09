import type { Block } from "./blocks";

/** 題名が「外部リンク」「題名なし」などの、整理したいページの名前 */
export const CLEANUP_TITLES = ["外部リンク", "題名なし", "題名無し", "無題", "untitled", "（題名なし）", "(題名なし)"];
const norm = (s: string) => s.normalize("NFKC").replace(/[\s　()（）]+/g, "").toLowerCase();
export const isCleanupTitle = (t: string) => CLEANUP_TITLES.some((x) => norm(x) === norm(t)) || norm(t) === "";

const plain = (x: string) => x.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
const live = (src: string) => src.startsWith("asset:") || /^https?:\/\//.test(src);

export interface BodyScan {
  /** 文字・画像・動画・ファイル・リンク・表の文字・子ページへの印など、中身と言えるものの数 */
  content: number;
  /** 取り込めていない（あとで入れるはずだった）画像・ファイルの印 */
  pending: number;
  /** 子ページ・データベースへの印（そこに中身がつながっている） */
  links: number;
}

/** ページの中身を調べる（空かどうか、取り込み漏れの印がないか） */
export function scanBody(blocks: Block[]): BodyScan {
  const r: BodyScan = { content: 0, pending: 0, links: 0 };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      switch (b.t) {
        case "h": case "p": case "ul": case "ol": case "todo": case "quote": case "code": case "toggle":
          if (plain(b.x)) r.content++;
          break;
        case "callout": if (plain(b.x ?? "") || plain(b.icon ?? "")) r.content++; break;
        case "table": if (b.rows.some((row) => row.some((c) => plain(c)))) r.content++; break;
        case "img": r.content++; if (!live(b.src)) r.pending++; break;
        case "file": r.content++; if (!live(b.src)) r.pending++; break;
        case "video": case "link": r.content++; break;
        case "child": case "db": r.content++; r.links++; break;
        case "hr": case "cols": break;
      }
      if (b.t === "cols") b.cols.forEach(walk);
      if ("children" in b && b.children) walk(b.children);
    }
  };
  walk(blocks);
  return r;
}

const keyOf = (x: string) => x.replace(/-/g, "");
/** 子ページへの印(child/db)以外で、このページ(key)を呼んでいるところがあるか（文章の中のリンクなど） */
export function refersTo(blocks: Block[], key: string): boolean {
  for (const b of blocks) {
    if (b.t === "child" || b.t === "db") continue;
    const { children: _c, cols: _o, ...self } = b as Block & { children?: Block[]; cols?: Block[][] };
    if (keyOf(JSON.stringify(self)).includes(key)) return true;
    if (b.t === "cols" && b.cols.some((c) => refersTo(c, key))) return true;
    if ("children" in b && b.children && refersTo(b.children, key)) return true;
  }
  return false;
}
/** 消したページへの印(child/db)を、親ページの中から取りのぞく */
export function dropChildRefs(blocks: Block[], key: string): Block[] {
  return blocks
    .filter((b) => !((b.t === "child" || b.t === "db") && keyOf(b.ref) === key))
    .map((b) => (b.t === "cols" ? { ...b, cols: b.cols.map((c) => dropChildRefs(c, key)) } : "children" in b && b.children ? ({ ...b, children: dropChildRefs(b.children, key) } as Block) : b));
}
