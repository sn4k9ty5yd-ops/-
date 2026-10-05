"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import type { ManualPageRow } from "@/lib/service";

function Tree({ rows, parent, depth }: { rows: Map<string | null, ManualPageRow[]>; parent: string | null; depth: number }) {
  const list = rows.get(parent) ?? [];
  return (
    <ul className="list" style={{ margin: depth ? "0 0 0 14px" : undefined }}>
      {list.map((p) => {
        const kids = rows.get(p.id)?.length ?? 0;
        return (
          <li key={p.id} style={{ display: "block" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <Link href={`/manual/${p.id}`} style={{ flex: 1, textDecoration: "none", color: "var(--ink)" }}><b>{p.icon || "📄"} {p.title}</b></Link>
              {p.minLevel > 1 && <span className="chip" title="見られる人が限られています">🔒 レベル{p.minLevel}以上</span>}
            </div>
            {kids > 0 && depth < 2 && (
              <details style={{ marginTop: 4 }}><summary className="sub" style={{ cursor: "pointer" }}>中のページ（{kids}）</summary><Tree rows={rows} parent={p.id} depth={depth + 1} /></details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Page() {
  const { me } = useMe();
  const [rows, setRows] = useState<ManualPageRow[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ManualPageRow[] | null>(null);
  useEffect(() => { api<ManualPageRow[]>("/api/manual").then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => {
    if (!q.trim()) { setFound(null); return; }
    const t = setTimeout(() => api<ManualPageRow[]>(`/api/manual?q=${encodeURIComponent(q.trim())}`).then(setFound).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, ManualPageRow[]>();
    const ids = new Set((rows ?? []).map((r) => r.id));
    for (const r of rows ?? []) { const k = r.parentId && ids.has(r.parentId) ? r.parentId : null; m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  }, [rows]);
  return (
    <main style={{ maxWidth: 900 }}>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>マニュアル</h1>
      <Link href="/meetings" className="card" style={{ display: "block", textDecoration: "none", color: "var(--ink)", marginBottom: 12 }}><b>🎙 ミーティング（議事録）</b><br /><span className="sub">会議のボイスメモ → 文字起こし・議事録・要約・マインドマップ・AI会議</span></Link>
      <Link href="/lesson-check" className="card" style={{ display: "block", textDecoration: "none", color: "var(--ink)", marginBottom: 12 }}><b>📝 レッスンチェック表</b><br /><span className="sub">アシスタントの技術チェック（シャンプー・カット・カラーなど）。項目ごとに1〜5で採点して、合格かどうかを見られます。</span></Link>
      <input placeholder="🔍 さがす（題名・本文）" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {found ? (
        found.length === 0 ? <p className="hint">見つかりませんでした。</p> : (
          <ul className="list">{found.map((p) => <li key={p.id}><Link href={`/manual/${p.id}`}><b>{p.icon || "📄"} {p.title}</b></Link></li>)}</ul>
        )
      ) : rows === null ? null : rows.length === 0 ? (
        <p className="hint">まだマニュアルがありません。{me.level >= 4 ? "取り込みが終わると、ここに並びます。" : ""}</p>
      ) : <Tree rows={byParent} parent={null} depth={0} />}
    </main>
  );
}
export default function ManualList() { return <MeProvider><Page /></MeProvider>; }
