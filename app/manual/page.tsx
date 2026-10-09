"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import type { ManualPageRow } from "@/lib/service";

function Page() {
  const { me } = useMe();
  const [rows, setRows] = useState<ManualPageRow[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ManualPageRow[] | null>(null);
  const [extN, setExtN] = useState(0);   // 外部リンクが1つも無いときは、「外部リンク」のカードを出さない
  useEffect(() => { api<{ links: unknown[] }[]>("/api/manual?external=1").then((r) => setExtN(r.reduce((n, x) => n + x.links.length, 0))).catch(() => setExtN(0)); }, []);
  useEffect(() => { api<ManualPageRow[]>("/api/manual").then((r) => setRows(r.filter((x) => !/メンター/.test(x.title)))).catch(() => setRows([])); }, []);
  useEffect(() => {
    if (!q.trim()) { setFound(null); return; }
    const t = setTimeout(() => api<ManualPageRow[]>(`/api/manual?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.filter((x) => !/メンター/.test(x.title)))).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, ManualPageRow[]>();
    const ids = new Set((rows ?? []).map((r) => r.id));
    for (const r of rows ?? []) { const k = r.parentId && ids.has(r.parentId) ? r.parentId : null; m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  }, [rows]);
  const tops = byParent.get(null) ?? [];
  const kidsOf = (id: string) => byParent.get(id)?.length ?? 0;
  const card = (p: ManualPageRow, big = true) => (
    <Link key={p.id} href={`/manual/${p.id}`} className="mncard">
      <span className="mnic">{p.icon || "📄"}</span>
      <span className="mnt">{p.title}</span>
      <span className="mns">{kidsOf(p.id) > 0 ? `中のページ ${kidsOf(p.id)}` : "ひらく"}{p.minLevel > 1 ? " · 🔒" : ""}</span>
    </Link>
  );
  return (
    <main style={{ maxWidth: 900 }}>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>マニュアル</h1>
      <input placeholder="🔍 さがす（題名・本文）" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {found ? (
        found.length === 0 ? <p className="hint">見つかりませんでした。</p> : (
          <ul className="list">{found.map((p) => <li key={p.id}><Link href={`/manual/${p.id}`}><b>{p.icon || "📄"} {p.title}</b></Link></li>)}</ul>
        )
      ) : (
        <>
          <div className="mngrid mnspecial">
            <Link href="/lesson-check" className="mncard special"><span className="mnic">📝</span><span className="mnt">レッスンチェック表</span><span className="mns">アシスタントの採点</span></Link>
            {extN > 0 && <Link href="/manual/external" className="mncard special"><span className="mnic">🔗</span><span className="mnt">外部リンク</span><span className="mns">YouTube以外の外のサイト</span></Link>}
            {me.level >= 4 && <Link href="/manual/cleanup" className="mncard special"><span className="mnic">🧹</span><span className="mnt">空のページの整理</span><span className="mns">「題名なし」などを調べて消す</span></Link>}
          </div>
          {rows === null ? null : rows.length === 0 ? (
            <p className="hint">まだマニュアルがありません。{me.level >= 4 ? "取り込みが終わると、ここに並びます。" : ""}</p>
          ) : (
            <>
              <h2 className="mnh">マニュアル一覧</h2>
              <div className="mngrid">{tops.map((p) => card(p))}</div>
            </>
          )}
        </>
      )}
    </main>
  );
}
export default function ManualList() { return <MeProvider><Page /></MeProvider>; }
