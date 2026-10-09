"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, MeProvider } from "@/lib/client";
import type { ManualExternal } from "@/lib/service";

const KIND: Record<string, string> = { link: "🔗", video: "▶", file: "📎", text: "🔗" };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

function Page() {
  const [rows, setRows] = useState<ManualExternal[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api<ManualExternal[]>("/api/manual?external=1").then(setRows).catch(() => setRows([])); }, []);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? []).map((r) => ({ ...r, links: r.links.filter((l) => !k || `${l.label} ${l.url} ${r.title}`.toLowerCase().includes(k)) })).filter((r) => r.links.length > 0);
  }, [rows, q]);
  const total = (rows ?? []).reduce((n, r) => n + r.links.length, 0);
  return (
    <main style={{ maxWidth: 900 }}>
      <Link href="/manual" className="back">← マニュアル</Link>
      <h1>🔗 外部リンク</h1>
      <p className="hint">マニュアルの中にあった、外のサイトへのリンク（YouTube以外）を、ここにまとめました。押すと、外のサイトが開きます（開く前に確認が出ます）。{rows ? `全部で ${total} 件。` : ""}</p>
      <input placeholder="🔍 さがす（名前・アドレス・もとのページ）" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {rows === null ? null : shown.length === 0 ? <p className="hint">{total === 0 ? "外部リンクは、ありません。" : "見つかりませんでした。"}</p> : shown.map((r) => (
        <div key={r.pageId} className="card" style={{ marginBottom: 10 }}>
          <Link href={`/manual/${r.pageId}`} style={{ textDecoration: "none", color: "var(--ink)" }}><b>{r.icon || "📄"} {r.title}</b> <span className="sub">（もとのページ ›）</span></Link>
          <ul className="list" style={{ margin: "6px 0 0" }}>
            {r.links.map((l) => (
              <li key={l.url} style={{ display: "block" }}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!confirm(`外のサイトを開きます。\n${host(l.url) || l.url}\n\nよいですか？`)) e.preventDefault(); }}>{KIND[l.kind]} {l.label}</a>
                <div className="sub" style={{ wordBreak: "break-all" }}>{host(l.url)}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </main>
  );
}
export default function ExternalLinks() { return <MeProvider><Page /></MeProvider>; }
