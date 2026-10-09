import type { Block } from "./blocks";

/** アプリに同梱してある資料（PDF）。マニュアルのページ（取り込み元ID）ごとに、ファイル名と置く場所の言葉を決めてある */
export interface BundledFile { file: string; name: string; label: string }
export interface BundledSet { sourceId: string; dir: string; toggle: string; files: BundledFile[]; group?: string }   // group: この言葉の見出し以降を、ひとつの開閉する項目にまとめる

export const BUNDLED_SETS: BundledSet[] = [
  {
    sourceId: "a5cfe309115c8311b9af017f6ad0fd6a", // アキバ塾動画（動画関連）
    dir: "akiba",
    toggle: "教科書",
    files: [1, 2, 3, 4, 5, 6].map((n) => ({ file: `${n}.pdf`, name: `${n}回目.pdf`, label: `${n}回目授業` })),
  },
  {
    sourceId: "2b7fe309115c82dba567818ac94c4895", // 動画関連（あきば塾の部分を、ひとつの項目にまとめる）
    dir: "akiba",
    toggle: "教科書",
    group: "あきば塾",
    files: [1, 2, 3, 4, 5, 6].map((n) => ({ file: `${n}.pdf`, name: `${n}回目.pdf`, label: `${n}回目授業` })),
  },
];

const norm = (x: string) => plain(x).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase();

/** 見出し(keyword)から、次の同じ大きさ以上の見出しの手前までを、ひとつの開閉する項目にまとめる。「📕…」「🎥…」で始まる文章は、さらにその中の項目にする。すでにまとめてあれば何もしない */
export function groupSection(body: Block[], keyword: string): { body: Block[]; grouped: boolean } {
  const key = norm(keyword);
  if (body.some((b) => b.t === "toggle" && norm(b.x).includes(key))) return { body, grouped: false };
  const at = body.findIndex((b) => b.t === "h" && norm(b.x).includes(key));
  if (at < 0) return { body, grouped: false };
  const head = body[at] as Extract<Block, { t: "h" }>;
  let end = body.length;
  for (let i = at + 1; i < body.length; i++) { const b = body[i]; if (b.t === "h" && b.l <= head.l) { end = i; break; } }
  const inner = body.slice(at + 1, end);
  const kids: Block[] = [];
  let cur: Extract<Block, { t: "toggle" }> | null = null;
  for (const b of inner) {
    if (b.t === "p" && /^[\u{1F4D5}\u{1F3A5}\u{1F4D6}\u{1F4F9}]/u.test(plain(b.x))) { cur = { t: "toggle", x: b.x, children: [] }; kids.push(cur); }
    else if (cur) cur.children.push(b);
    else kids.push(b);
  }
  const tog: Block = { t: "toggle", x: head.x, color: head.color, children: kids };
  return { body: [...body.slice(0, at), tog, ...body.slice(end)], grouped: true };
}

const plain = (x: string) => x.replace(/<[^>]+>/g, "").normalize("NFKC").replace(/\s+/g, "");
const hasFile = (bs: Block[], name: string): boolean =>
  bs.some((b) => (b.t === "file" && b.name === name) || (b.t === "cols" && b.cols.some((c) => hasFile(c, name))) || ("children" in b && !!b.children && hasFile(b.children, name)));

/** 資料のファイルの印(asset:…)を、ページの中に入れる。すでに同じ名前のファイルがあれば入れない。入れた数を返す */
export function mergeBundled(body: Block[], set: BundledSet, refs: Record<string, string>): { body: Block[]; added: number } {
  const g = set.group ? groupSection(structuredClone(body), set.group) : { body: structuredClone(body), grouped: false };
  const next = g.body;
  const holder = (bs: Block[]): Block[] | null => {
    for (const b of bs) {
      if (b.t === "toggle" && plain(b.x).includes(set.toggle)) return b.children;
      if (b.t === "toggle") { const h = holder(b.children); if (h) return h; }
    }
    return null;
  };
  const list = holder(next) ?? next;
  let added = 0;
  for (const f of set.files) {
    const src = refs[f.file];
    if (!src || hasFile(next, f.name)) continue;
    const at = list.findIndex((b) => b.t === "p" && plain(b.x).includes(plain(f.label)));
    const blk: Block = { t: "file", src, name: f.name };
    if (at >= 0) {
      let to = at + 1;
      while (to < list.length && list[to].t === "file") to++;
      list.splice(to, 0, blk);
    } else list.push(blk);
    added++;
  }
  return { body: next, added: added + (g.grouped ? 1 : 0) };
}
