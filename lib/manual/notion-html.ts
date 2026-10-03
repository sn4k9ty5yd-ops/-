import { parse, HTMLElement, NodeType, type Node } from "node-html-parser";
import type { Block } from "./blocks";

/** Notion の「HTMLで書き出し」の1ページを、マニュアルのブロックに変える */
export interface ParsedNotionPage {
  sourceId: string;            // ページのID（32けた・ハイフンなし）
  title: string;
  icon: string;
  blocks: Block[];
  childIds: string[];          // このページから、子ページとして辿れるページのID
}

const hex32 = (s: string | undefined) => (s ?? "").replace(/-/g, "").match(/[0-9a-f]{32}/)?.[0] ?? "";
const notionUrl = (id: string) => `https://www.notion.so/${id}`;
const colorOf = (el: HTMLElement): string | undefined => {
  const cls = el.getAttribute("class") ?? "";
  const m = /(?:highlight|block-color)-([a-z]+(?:_background)?)/.exec(cls);
  if (!m || m[1] === "default") return undefined;
  return m[1].replace("_background", "_bg");
};

/** 文章の中の飾りを、アプリの書き方（**太字** など）にする */
function inline(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text.replace(/ /g, " ");
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.rawTagName?.toLowerCase();
  const inner = () => el.childNodes.map(inline).join("");
  switch (tag) {
    case "strong": case "b": { const s = inner(); return s.trim() ? `**${s}**` : s; }
    case "em": case "i": { const s = inner(); return s.trim() ? `*${s}*` : s; }
    case "del": case "s": return `~~${inner()}~~`;
    case "u": return `<u>${inner()}</u>`;
    case "code": return "`" + el.text + "`";
    case "br": return "<br>";
    case "mark": case "span": {
      if (el.classNames?.includes?.("icon")) return "";
      const c = colorOf(el);
      return c ? `<span color="${c}">${inner()}</span>` : inner();
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const id = el.getAttribute("data-notion-page-id");
      const label = inner();
      if (!href) return label;
      const url = id ? notionUrl(hex32(id)) : href;
      return `[${label.replace(/[\[\]]/g, "")}](${url.replace(/\)/g, "%29")})`;
    }
    case "img": case "svg": return "";
    default: return inner();
  }
}
const text = (el: HTMLElement) => el.childNodes.map(inline).join("").replace(/^\s+|\s+$/g, "");

function cellText(td: HTMLElement): string { return text(td); }

function parseTable(table: HTMLElement): Block {
  const rows: string[][] = [];
  let header = false;
  const head = table.querySelector("thead");
  if (head) header = true;
  for (const tr of table.querySelectorAll("tr")) rows.push(tr.querySelectorAll("th,td").map(cellText));
  const headerCol = /header-column/.test(table.getAttribute("class") ?? "") || undefined;
  return { t: "table", header, ...(headerCol ? { headerCol } : {}), rows };
}

/** データベース（表示は表形式）：列の名前＋行。選べる値（点数など）は列ごとに集めて、選択肢にする */
function parseCollection(wrap: HTMLElement, childIds: string[]): Block[] {
  const out: Block[] = [];
  const title = wrap.querySelector(".collection-title");
  if (title && text(title)) out.push({ t: "h", l: 3, x: text(title) });
  const table = wrap.querySelector("table");
  if (table) {
    for (const a of table.querySelectorAll("a[data-notion-page-id]")) childIds.push(hex32(a.getAttribute("data-notion-page-id")));
    const b = parseTable(table);
    if (b.t === "table") {
      // 点数のような「選べる値」が決まっている列は、プルダウンにする（1つの列の値が、少ない種類の短い言葉だけのとき）
      const body = b.rows.slice(1);
      const choices = b.rows[0].map((_, c) => {
        const vals = [...new Set(body.map((r) => r[c] ?? "").filter(Boolean))];
        return c > 0 && vals.length > 0 && vals.length <= 8 && vals.every((v) => v.length <= 3 && /^[０-９0-9A-Za-zぁ-んァ-ヶ一-龥]+$/.test(v)) ? vals : null;
      });
      void choices;   // 選択肢は、書き出しだけでは正しく決められない（未入力の値が見えない）ため、取り込み側（スクリプト）の指定で付ける
      out.push(b);
    }
  }
  return out;
}

function blocksOf(parent: HTMLElement, childIds: string[]): Block[] {
  const out: Block[] = [];
  for (const node of parent.childNodes) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.rawTagName?.toLowerCase();
    const cls = el.getAttribute("class") ?? "";
    const kids = () => { const ind = el.querySelector(":scope > .indented"); return ind ? blocksOf(ind, childIds) : []; };
    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": {
        const color = colorOf(el);
        out.push({ t: "h", l: Math.min(4, Number(tag[1])) as 1 | 2 | 3 | 4, x: text(el), ...(color ? { color } : {}) });
        break;
      }
      case "p": {
        const x = text(el);
        if (x) { const color = colorOf(el); out.push({ t: "p", x, ...(color ? { color } : {}) }); }
        break;
      }
      case "ul": case "ol": {
        const todo = /to-do-list/.test(cls);
        for (const li of el.querySelectorAll(":scope > li")) {
          const box = li.querySelector(".checkbox");
          const cloneText = li.childNodes.filter((n) => !(n.nodeType === NodeType.ELEMENT_NODE && ["ul", "ol", "div"].includes((n as HTMLElement).rawTagName?.toLowerCase()) && !/checkbox/.test((n as HTMLElement).getAttribute("class") ?? ""))).map((n) => (n.nodeType === NodeType.ELEMENT_NODE && /checkbox/.test((n as HTMLElement).getAttribute("class") ?? "") ? "" : inline(n))).join("").trim();
          const sub = li.querySelectorAll(":scope > ul, :scope > ol");
          const children = sub.length ? sub.flatMap((s) => blocksOf({ childNodes: [s] } as unknown as HTMLElement, childIds)) : undefined;
          if (todo || box) out.push({ t: "todo", x: cloneText, checked: /checkbox-on/.test(box?.getAttribute("class") ?? ""), ...(children?.length ? { children } : {}) });
          else out.push({ t: tag === "ol" ? "ol" : "ul", x: cloneText, ...(children?.length ? { children } : {}) });
        }
        break;
      }
      case "blockquote": out.push({ t: "quote", x: text(el) }); break;
      case "hr": out.push({ t: "hr" }); break;
      case "pre": out.push({ t: "code", x: el.text.replace(/\n$/, "") }); break;
      case "aside": {
        const icon = el.getAttribute("data-notion-callout-icon") ?? "";
        const bg = (el.getAttribute("data-notion-callout-background") ?? "gray_background").replace("_background", "_bg");
        const body = el.querySelector(":scope > div:last-child");
        const inner = body ? blocksOf(body, childIds) : [];
        const lone = body && !inner.length ? text(body) : "";
        out.push({ t: "callout", icon, color: bg, ...(lone ? { x: lone } : {}), children: inner });
        break;
      }
      case "details": {
        const sum = el.querySelector(":scope > summary");
        const ind = el.querySelector(":scope > .indented");
        const sumText = sum ? text(sum) : "";
        out.push({ t: "toggle", x: sumText, children: ind ? blocksOf(ind, childIds) : [] });
        break;
      }
      case "figure": {
        if (/\bimage\b/.test(cls)) {
          const img = el.querySelector("img");
          const cap = el.querySelector("figcaption");
          if (img) out.push({ t: "img", src: img.getAttribute("src") ?? "", ...(cap && text(cap) ? { cap: text(cap) } : {}) });
        } else if (/link-to-page/.test(cls)) {
          const a = el.querySelector("a");
          const id = hex32(a?.getAttribute("data-notion-page-id"));
          if (id) { childIds.push(id); out.push({ t: "child", ref: notionUrl(id), title: a ? text(a) : "" }); }
        } else {
          const a = el.querySelector("a");
          const href = a?.getAttribute("href") ?? "";
          if (/^https?:/.test(href)) {
            if (/youtu\.?be|vimeo/.test(href)) out.push({ t: "video", url: href });
            else out.push({ t: "link", url: href, x: a ? text(a) : href });
          } else if (href) {
            const name = decodeURIComponent(href.split("/").pop() ?? "ファイル");
            out.push({ t: "file", src: href, name });
          }
        }
        break;
      }
      case "table": out.push(parseTable(el)); break;
      case "div": {
        if (/column-list/.test(cls)) {
          const cols = el.querySelectorAll(":scope > .column").map((c) => blocksOf(c, childIds));
          out.push({ t: "cols", cols });
        } else if (/collection-content/.test(cls)) out.push(...parseCollection(el, childIds));
        else if (/indented/.test(cls) || !cls) out.push(...blocksOf(el, childIds));
        break;
      }
      default: break;
    }
  }
  return out;
}

export function parseNotionHtml(html: string): ParsedNotionPage {
  const root = parse(html);
  const article = root.querySelector("article");
  if (!article) throw new Error("Notionのページの形式ではありません");
  const sourceId = hex32(article.getAttribute("id"));
  const title = text(article.querySelector("h1.page-title") ?? article.querySelector("h1") ?? article).replace(/^\s+|\s+$/g, "");
  const icon = article.getAttribute("data-notion-page-icon") ?? "";
  const body = article.querySelector(".page-body");
  const childIds: string[] = [];
  const blocks = body ? blocksOf(body, childIds) : [];
  return { sourceId, title: title.replace(icon, "").trim() || title, icon, blocks, childIds: [...new Set(childIds)] };
}
