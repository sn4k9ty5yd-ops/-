"use client";
import Link from "next/link";
import { Fragment, type ReactNode, useState } from "react";
import { assetUrl, type Block } from "./blocks";
import { isExternal } from "./links";

const COLORS: Record<string, string> = {
  red: "#d70015", blue: "#0a64c8", green: "#1a7f37", yellow: "#a16207", orange: "#c2410c", purple: "#7e3fb0", pink: "#c2306e", brown: "#7a4b2a", gray: "#6e6e73", default: "inherit",
};
const BGS: Record<string, string> = {
  red_bg: "#fde8ea", blue_bg: "#e6f0fb", green_bg: "#e5f5ea", yellow_bg: "#fff3c4", orange_bg: "#ffead8", purple_bg: "#f0e8f8", pink_bg: "#fbe6f0", brown_bg: "#f1e7df", gray_bg: "#f0f0f3", default_bg: "transparent",
};
const colorStyle = (c?: string): React.CSSProperties => (!c ? {} : c.endsWith("_bg") ? { background: BGS[c] ?? "transparent", padding: "0 2px", borderRadius: 3 } : { color: COLORS[c] ?? "inherit" });

export interface Refs { [sourceKey: string]: { id: string; title: string; icon: string } }
export interface ViewCtx { refs: Refs; canEdit: boolean; onEdit: (edit: object) => Promise<void> }

/** Notion のURLから、32けたのIDを取り出す */
export const notionKey = (url: string) => (url.replace(/-/g, "").match(/[0-9a-f]{32}/g) ?? []).pop() ?? "";

/** 文章の中の飾り（太字・色・リンクなど）を表示用に直す */
export function Inline({ text, refs }: { text: string; refs?: Refs }): ReactNode {
  return <>{inline(text ?? "", refs ?? {}, 0)}</>;
}
function inline(s: string, refs: Refs, depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0, buf = "", k = 0;
  const flush = () => { if (buf) { out.push(<Fragment key={k++}>{buf}</Fragment>); buf = ""; } };
  const close = (open: string, end: string, from: number) => s.indexOf(end, from + open.length);
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if (depth < 6 && (m = /^<span color="([^"]+)">/.exec(rest))) {
      const e = close(m[0], "</span>", i);
      if (e > 0) { flush(); out.push(<span key={k++} style={colorStyle(m[1])}>{inline(s.slice(i + m[0].length, e), refs, depth + 1)}</span>); i = e + 7; continue; }
    }
    if (depth < 6 && rest.startsWith("**")) { const e = close("**", "**", i); if (e > 0) { flush(); out.push(<b key={k++}>{inline(s.slice(i + 2, e), refs, depth + 1)}</b>); i = e + 2; continue; } }
    if (depth < 6 && rest.startsWith("~~")) { const e = close("~~", "~~", i); if (e > 0) { flush(); out.push(<s key={k++}>{inline(s.slice(i + 2, e), refs, depth + 1)}</s>); i = e + 2; continue; } }
    if (depth < 6 && rest.startsWith("<u>")) { const e = close("<u>", "</u>", i); if (e > 0) { flush(); out.push(<u key={k++}>{inline(s.slice(i + 3, e), refs, depth + 1)}</u>); i = e + 4; continue; } }
    if (rest.startsWith("`")) { const e = close("`", "`", i); if (e > 0) { flush(); out.push(<code key={k++}>{s.slice(i + 1, e)}</code>); i = e + 1; continue; } }
    if (depth < 6 && rest[0] === "*" && rest[1] !== "*" && rest[1] !== " ") { const e = close("*", "*", i); if (e > 0) { flush(); out.push(<i key={k++}>{inline(s.slice(i + 1, e), refs, depth + 1)}</i>); i = e + 1; continue; } }
    if (rest.startsWith("<br>") || rest.startsWith("<br/>")) { flush(); out.push(<br key={k++} />); i += rest.startsWith("<br>") ? 4 : 5; continue; }
    if ((m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const url = m[2].replace(/&amp;/g, "&");
      const hit = refs[notionKey(url)];
      out.push(hit && /notion\.(so|com|site)/.test(url)
        ? <Link key={k++} href={`/manual/${hit.id}`}>{m[1] || hit.title}</Link>
        : isExternal(url, new Set(Object.keys(refs)))
          ? <span key={k++} className="mn-ext" title="外部リンクは、マニュアルの「外部リンク」にまとめてあります">{inline(m[1] || "外部リンク", refs, depth + 1)} 🔗</span>
          : <a key={k++} href={url} target="_blank" rel="noopener noreferrer">{inline(m[1], refs, depth + 1)}</a>);
      i += m[0].length; continue;
    }
    if ((m = /^<[^>]+>/.exec(rest))) { i += m[0].length; continue; }   // 知らない印は表示しない
    buf += s[i++];
  }
  flush();
  return out;
}

/** YouTube のアドレスなら、そのまま再生できる形にする */
export function youtubeEmbed(url: string): string | null {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/|live\/)|[?&]v=)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: ViewCtx }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "ul" || b.t === "ol") {
      const run: Block[] = [b];
      while (i + 1 < blocks.length && blocks[i + 1].t === b.t) run.push(blocks[++i]);
      const Tag = b.t;
      out.push(<Tag key={i} className="mn-list">{run.map((it, j) => (
        <li key={j}><Inline text={(it as { x: string }).x} refs={ctx.refs} />{"children" in it && it.children && <Blocks blocks={it.children} ctx={ctx} />}</li>
      ))}</Tag>);
      continue;
    }
    out.push(<BlockItem key={i} b={b} ctx={ctx} />);
  }
  return <>{out}</>;
}

function Cell({ id, r, c, value, choices, ctx, header }: { id: string; r: number; c: number; value: string; choices?: string[] | null; ctx: ViewCtx; header: boolean }) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState("");
  const raw = value.replace(/<[^>]+>/g, "");
  if (!ctx.canEdit || header) return <Inline text={value} refs={ctx.refs} />;
  const save = async (t: string) => { setV(t); setErr(""); try { await ctx.onEdit({ op: "cell", id, r, c, text: t }); } catch (e) { setErr((e as Error).message); setV(raw); } };
  return choices ? (
    <select className="mn-cell" value={v.replace(/<[^>]+>/g, "")} onChange={(e) => save(e.target.value)} title={err}>
      <option value=""></option>{choices.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  ) : (
    <input className="mn-cell" value={v.replace(/<[^>]+>/g, "")} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== raw) save(v); }} title={err} />
  );
}

/** アプリに保存した画像か、インターネット上の画像だけ表示する（書き出したままの相対パスは、取り込み待ち） */
const live = (src: string) => src.startsWith("asset:") || /^https?:\/\//.test(src);

function BlockItem({ b, ctx }: { b: Block; ctx: ViewCtx }) {
  switch (b.t) {
    case "h": {
      const H = (`h${Math.min(4, b.l + 1)}`) as "h2" | "h3" | "h4" | "h5";
      return <><H className="mn-h" style={colorStyle(b.color)}><Inline text={b.x} refs={ctx.refs} /></H>{b.children && <Blocks blocks={b.children} ctx={ctx} />}</>;
    }
    case "p": return <><p className="mn-p" style={colorStyle(b.color)}><Inline text={b.x} refs={ctx.refs} /></p>{b.children && <div className="mn-indent"><Blocks blocks={b.children} ctx={ctx} /></div>}</>;
    case "todo": return <TodoItem b={b} ctx={ctx} />;
    case "ul": case "ol": return <ul className="mn-list"><li><Inline text={b.x} refs={ctx.refs} /></li></ul>;
    case "quote": return <blockquote className="mn-quote"><Inline text={b.x} refs={ctx.refs} />{b.children && <Blocks blocks={b.children} ctx={ctx} />}</blockquote>;
    case "hr": return <hr />;
    case "code": return <pre className="mn-code">{b.x}</pre>;
    case "callout": return (
      <div className="mn-callout" style={{ background: BGS[b.color] ?? "#f0f0f3" }}>
        <span className="mn-icon">{b.icon}</span>
        <div>{b.x && <p className="mn-p"><Inline text={b.x} refs={ctx.refs} /></p>}<Blocks blocks={b.children} ctx={ctx} /></div>
      </div>
    );
    case "toggle": return (
      <details className="mn-toggle">
        <summary style={colorStyle(b.color)}><Inline text={b.x} refs={ctx.refs} /></summary>
        <div className="mn-indent"><Blocks blocks={b.children} ctx={ctx} /></div>
      </details>
    );
    case "cols": return <div className="mn-cols">{b.cols.map((c, i) => <div key={i}><Blocks blocks={c} ctx={ctx} /></div>)}</div>;
    case "table": return (
      <div className="mn-tablewrap"><table className="mn-table"><tbody>
        {b.rows.map((row, r) => (
          <tr key={r}>{row.map((cell, c) => {
            const head = (b.header && r === 0) || (b.headerCol && c === 0);
            const T = head ? "th" : "td";
            return <T key={c}>{b.id && b.edit ? <Cell id={b.id} r={r} c={c} value={cell} choices={b.choices?.[c]} ctx={ctx} header={!!head} /> : <Inline text={cell} refs={ctx.refs} />}</T>;
          })}</tr>
        ))}
      </tbody></table></div>
    );
    case "img": return live(b.src)
      ? <figure className="mn-fig"><a href={assetUrl(b.src)} target="_blank" rel="noopener noreferrer"><img src={assetUrl(b.src)} alt={b.cap ?? ""} loading="lazy" /></a>{b.cap && <figcaption>{b.cap}</figcaption>}</figure>
      : <p className="mn-p sub">🖼 画像（取り込み待ち）</p>;
    case "video": {
      const e = youtubeEmbed(b.url);
      return e
        ? <div className="mn-video"><iframe src={e} title="動画" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
        : <p className="mn-p sub">▶ 動画（外部のサイト）は、マニュアルの「外部リンク」にまとめてあります。</p>;
    }
    case "file": return /^https?:\/\//i.test(b.src) ? <p className="mn-p sub">📎 {b.name}（外部のファイルは、マニュアルの「外部リンク」にまとめてあります）</p> : live(b.src)
      ? <p className="mn-p"><a className="mn-file" href={assetUrl(b.src)} target="_blank" rel="noopener noreferrer">📎 {b.name}</a></p>
      : <p className="mn-p sub">📎 {b.name}（取り込み待ち）</p>;
    case "link": return isExternal(b.url, new Set(Object.keys(ctx.refs)))
      ? <p className="mn-p"><span className="mn-ext" title="外部リンクは、マニュアルの「外部リンク」にまとめてあります">🔗 {b.x || b.url}</span> <span className="sub">（外部リンクにあります）</span></p>
      : <p className="mn-p"><a href={b.url} target="_blank" rel="noopener noreferrer">{b.x || b.url}</a></p>;
    case "child": case "db": {
      const hit = ctx.refs[notionKey(b.ref)];
      return hit
        ? <p className="mn-p"><Link className="mn-childlink" href={`/manual/${hit.id}`}>{hit.icon || "📄"} {hit.title || b.title}</Link></p>
        : b.title ? <p className="mn-p sub">{b.title}</p> : null;
    }
  }
}

function TodoItem({ b, ctx }: { b: Extract<Block, { t: "todo" }>; ctx: ViewCtx }) {
  const [on, setOn] = useState(!!b.checked);
  const [err, setErr] = useState("");
  return (
    <label className="mn-todo" title={err}>
      <input type="checkbox" checked={on} disabled={!ctx.canEdit || !b.id}
        onChange={async (e) => { const v = e.target.checked; setOn(v); setErr(""); try { await ctx.onEdit({ op: "todo", id: b.id ?? "", checked: v }); } catch (x) { setOn(!v); setErr((x as Error).message); } }} />
      <span style={on ? { color: "var(--sub)" } : undefined}><Inline text={b.x} refs={ctx.refs} /></span>
    </label>
  );
}

export function BlockView({ blocks, ctx }: { blocks: Block[]; ctx: ViewCtx }) { return <Blocks blocks={blocks} ctx={ctx} />; }
