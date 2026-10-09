import type { Block } from "./blocks";

/** YouTube のアドレスか（これだけは、マニュアルの中でそのまま再生する） */
export const isYouTube = (url: string) => /(?:youtu\.be\/|youtube\.com\/|youtube-nocookie\.com\/)/.test(url);
const isHttp = (url: string) => /^https?:\/\//i.test(url);
const notionKey = (url: string) => (url.replace(/-/g, "").match(/[0-9a-f]{32}/g) ?? []).pop() ?? "";

/** マニュアルの外へ出てしまうリンクか（YouTube と、マニュアルの中のページへのリンクは除く） */
export function isExternal(url: string, internalKeys?: Set<string>): boolean {
  if (!isHttp(url) || isYouTube(url)) return false;
  if (/notion\.(so|com|site)/.test(url) && internalKeys?.has(notionKey(url))) return false;
  return true;
}

export interface ExtLink { url: string; label: string; kind: "link" | "video" | "file" | "text" }

/** ページの中から、外部リンクを集める（同じアドレスは1つにまとめる） */
export function collectExternal(blocks: Block[], internalKeys?: Set<string>): ExtLink[] {
  const seen = new Set<string>(); const out: ExtLink[] = [];
  const add = (url: string, label: string, kind: ExtLink["kind"]) => { if (!isExternal(url, internalKeys) || seen.has(url)) return; seen.add(url); out.push({ url, label: label.trim() || url, kind }); };
  const scanText = (s: string) => { for (const m of s.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) add(m[2].replace(/&amp;/g, "&"), m[1].replace(/<[^>]+>|\*\*|~~|`/g, ""), "text"); };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === "link") add(b.url, b.x, "link");
      else if (b.t === "video") add(b.url, "動画", "video");
      else if (b.t === "file") add(b.src, b.name, "file");
      if ("x" in b && typeof b.x === "string") scanText(b.x);
      if (b.t === "table") b.rows.forEach((r) => r.forEach(scanText));
      if (b.t === "cols") b.cols.forEach(walk);
      if ("children" in b && b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}
