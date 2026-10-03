import type { Block } from "./blocks";

const COLOR = / ?\{color="([^"]+)"\}\s*$/;
const attr = (s: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(s)?.[1];
const dedent = (lines: string[]) => lines.map((l) => (l.startsWith("\t") ? l.slice(1) : l.startsWith("  ") ? l.slice(2) : l));
const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
/** 画像などのURLに入っている &amp; などを元に戻す */
const decodeUrl = (u: string) => unesc(u).replace(/#notion_record=.*$/, "");

/** Notion の「拡張マークダウン」を、マニュアルのブロックに変える */
export function parseEnhancedMarkdown(text: string): Block[] {
  return parse(text.replace(/\r/g, "").split("\n"));
}

function endOf(lines: string[], from: number, close: string): number {
  for (let j = from + 1; j < lines.length; j++) if (lines[j].trimEnd() === close) return j;
  return lines.length;
}

function parse(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  const childrenAfter = (): Block[] | undefined => {
    const kids: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1].startsWith("\t") || lines[i + 1].startsWith("  ") || lines[i + 1].trim() === "")) {
      if (lines[i + 1].trim() === "" && !(lines[i + 2]?.startsWith("\t"))) break;
      kids.push(lines[++i]);
    }
    const bs = parse(dedent(kids));
    return bs.length ? bs : undefined;
  };
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const t = line.trim();
    if (t === "" || t === "<empty-block/>") { i++; continue; }

    // ---- 囲み（トグル・コールアウト・列・表など）
    let m: RegExpExecArray | null;
    if (t.startsWith("<details")) {
      const e = endOf(lines, i, "</details>");
      const inner = lines.slice(i + 1, e);
      const sm = /^<summary>([\s\S]*?)<\/summary>$/.exec((inner[0] ?? "").trim());
      const color = attr(t, "color");
      out.push({ t: "toggle", x: sm ? sm[1] : "", ...(color ? { color } : {}), children: parse(dedent(sm ? inner.slice(1) : inner)) });
      i = e + 1; continue;
    }
    if (t.startsWith("<callout")) {
      const e = endOf(lines, i, "</callout>");
      const kids = parse(dedent(lines.slice(i + 1, e)));
      out.push({ t: "callout", icon: attr(t, "icon") ?? "", color: attr(t, "color") ?? "gray_bg", children: kids });
      i = e + 1; continue;
    }
    if (t.startsWith("<columns")) {
      const e = endOf(lines, i, "</columns>");
      const body = dedent(lines.slice(i + 1, e));
      const cols: Block[][] = [];
      for (let k = 0; k < body.length; k++) {
        if (body[k].trim().startsWith("<column")) {
          const ce = endOf(body, k, "</column>");
          cols.push(parse(dedent(body.slice(k + 1, ce))));
          k = ce;
        }
      }
      out.push({ t: "cols", cols });
      i = e + 1; continue;
    }
    if (t.startsWith("<synced_block") || t.startsWith("<synced_block_reference")) {
      const close = t.startsWith("<synced_block_reference") ? "</synced_block_reference>" : "</synced_block>";
      const e = endOf(lines, i, close);
      out.push(...parse(dedent(lines.slice(i + 1, e))));
      i = e + 1; continue;
    }
    if (t.startsWith("<table")) {
      const e = endOf(lines, i, "</table>");
      const html = lines.slice(i, e + 1).join("\n");
      const rows: string[][] = [];
      for (const rm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        rows.push([...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].trim()));
      }
      const header = /header-row="true"/.test(t) || /<tr[^>]*color="gray_bg"/.test(html.split("</tr>")[0] ?? "");
      out.push({ t: "table", header, ...(/header-column="true"/.test(t) ? { headerCol: true } : {}), rows });
      i = e + 1; continue;
    }

    // ---- 1行で書かれるもの
    if ((m = /^<database\b[^>]*?(?:url="([^"]*)")?[^>]*>([\s\S]*?)<\/database>$/.exec(t)) || (m = /^<database\b[^>]*url="([^"]*)"[^>]*\/>$/.exec(t))) {
      out.push({ t: "db", ref: decodeUrl(m[1] ?? ""), title: m[2] ?? "" }); i++; continue;
    }
    if ((m = /^<page\b[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/page>$/.exec(t))) {
      out.push({ t: "child", ref: decodeUrl(m[1]), title: m[2] }); i++; continue;
    }
    if ((m = /^<(video|audio|embed|pdf)\b[^>]*src="([^"]*)"/.exec(t))) {
      const url = decodeUrl(m[2]);
      out.push(m[1] === "pdf" ? { t: "file", src: url, name: "PDF" } : { t: "video", url }); i++; continue;
    }
    if ((m = /^<file\b[^>]*src="([^"]*)"[^>]*>([\s\S]*?)(?:<\/file>)?$/.exec(t))) {
      const url = decodeUrl(m[1]);
      let name = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "ファイル");
      if (m[2]?.trim()) name = m[2].trim();
      out.push({ t: "file", src: url, name }); i++; continue;
    }
    if ((m = /^<bookmark\b[^>]*url="([^"]*)"/.exec(t))) { out.push({ t: "link", url: decodeUrl(m[1]), x: decodeUrl(m[1]) }); i++; continue; }
    if (t.startsWith("<unknown") || t.startsWith("<mention") && t.endsWith("/>")) { i++; continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t))) { out.push({ t: "img", src: decodeUrl(m[2]), ...(m[1] ? { cap: m[1] } : {}) }); i++; continue; }
    if (t === "---") { out.push({ t: "hr" }); i++; continue; }
    if (t.startsWith("```")) {
      const lang = t.slice(3).trim();
      const body: string[] = [];
      let k = i + 1;
      while (k < lines.length && !lines[k].trim().startsWith("```")) body.push(lines[k++]);
      out.push({ t: "code", x: body.join("\n"), ...(lang ? { lang } : {}) });
      i = k + 1; continue;
    }
    if ((m = /^(#{1,4}) (.*)$/.exec(t))) {
      let x = m[2]; const cm = COLOR.exec(x); if (cm) x = x.replace(COLOR, "");
      const kids = childrenAfter();
      out.push({ t: "h", l: m[1].length as 1 | 2 | 3 | 4, x, ...(cm ? { color: cm[1] } : {}), ...(kids ? { children: kids } : {}) });
      i++; continue;
    }
    if ((m = /^(?:- \[( |x)\] |[-*] |(\d+)\. )(.*)$/.exec(t)) && !raw.startsWith("\t")) {
      const kind = m[1] !== undefined ? "todo" : m[2] ? "ol" : "ul";
      const kids = childrenAfter();
      out.push({ t: kind, x: m[3], ...(kind === "todo" ? { checked: m[1] === "x" } : {}), ...(kids ? { children: kids } : {}) } as Block);
      i++; continue;
    }
    if (t.startsWith("> ")) { const kids = childrenAfter(); out.push({ t: "quote", x: t.slice(2), ...(kids ? { children: kids } : {}) }); i++; continue; }

    // ---- ふつうの文章
    let x = t; const cm = COLOR.exec(x); if (cm) x = x.replace(COLOR, "");
    // 1行すべてが「[URL](URL)」なら、リンク
    const kids = childrenAfter();
    out.push({ t: "p", x, ...(cm ? { color: cm[1] } : {}), ...(kids ? { children: kids } : {}) });
    i++;
  }
  return out;
}

/** <content> ... </content> の中身だけを取り出す（fetchの結果から） */
export function extractContent(fetchText: string): string {
  const m = /<content>\n?([\s\S]*?)\n?<\/content>/.exec(fetchText);
  return m ? m[1] : fetchText;
}
