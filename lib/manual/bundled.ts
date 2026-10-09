import type { Block } from "./blocks";

/** アプリに同梱してある資料（PDF）。マニュアルのページ（取り込み元ID）ごとに、ファイル名と置く場所の言葉を決めてある */
export interface BundledFile { file: string; name: string; label: string }
export interface BundledSet { sourceId: string; dir: string; toggle: string; files: BundledFile[] }

export const BUNDLED_SETS: BundledSet[] = [
  {
    sourceId: "a5cfe309115c8311b9af017f6ad0fd6a", // アキバ塾動画（動画関連）
    dir: "akiba",
    toggle: "教科書",
    files: [1, 2, 3, 4, 5, 6].map((n) => ({ file: `${n}.pdf`, name: `${n}回目.pdf`, label: `${n}回目授業` })),
  },
];

const plain = (x: string) => x.replace(/<[^>]+>/g, "").normalize("NFKC").replace(/\s+/g, "");
const hasFile = (bs: Block[], name: string): boolean =>
  bs.some((b) => (b.t === "file" && b.name === name) || (b.t === "cols" && b.cols.some((c) => hasFile(c, name))) || ("children" in b && !!b.children && hasFile(b.children, name)));

/** 資料のファイルの印(asset:…)を、ページの中に入れる。すでに同じ名前のファイルがあれば入れない。入れた数を返す */
export function mergeBundled(body: Block[], set: BundledSet, refs: Record<string, string>): { body: Block[]; added: number } {
  const next = structuredClone(body);
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
  return { body: next, added };
}
