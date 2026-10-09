"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import type { ManualCleanupRow } from "@/lib/service";

function Page() {
  const { me } = useMe();
  const [rows, setRows] = useState<ManualCleanupRow[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await api<ManualCleanupRow[]>("/api/manual?cleanup=1"); setRows(r); setSel(new Set(r.filter((x) => x.empty).map((x) => x.id))); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, []);
  useEffect(() => { if (me.level >= 4) load(); }, [me.level, load]);
  if (me.level < 4) return <main><Link href="/manual" className="back">← マニュアル</Link><p className="err">この画面は、正美さん以上だけが使えます。</p></main>;
  const empties = (rows ?? []).filter((x) => x.empty);
  const del = async () => {
    if (sel.size === 0) return;
    if (!confirm(`チェックした${sel.size}ページを消します。元に戻せません。よろしいですか？`)) return;
    setBusy(true);
    try { const r = await api<{ deleted: number; skipped: number }>("/api/manual", { action: "deleteEmpty", ids: [...sel] }); setMsg(`${r.deleted}ページを消しました${r.skipped ? `（${r.skipped}ページは、調べ直したら中身があったので消していません）` : ""}`); await load(); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  return (
    <main style={{ maxWidth: 900 }}>
      <Link href="/manual" className="back">← マニュアル</Link>
      <h1>🧹 空のページの整理</h1>
      <p className="sub">題名が「外部リンク」「題名なし」のページを探し、本当に空かどうかを、1つずつ調べます。中身・下のページ・取り込めていない画像やファイルの印・ほかのページからの呼ばれ方があるものは、「空ではない」として、消せません。</p>
      {msg && <p className={msg.includes("消しました") ? "sub" : "err"}>{msg}</p>}
      {rows && rows.length === 0 && <p className="hint">該当するページはありません。</p>}
      {empties.length > 0 && (
        <div className="card" style={{ margin: "10px 0" }}>
          <b>空のページ（{empties.length}）</b>
          <ul className="list">
            {empties.map((r) => (
              <li key={r.id} style={{ display: "block" }}>
                <label style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                  <input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                  <span><b>{r.icon} {r.title}</b><br /><span className="sub">{r.path || "（いちばん上）"}　中身なし・下のページなし・取り込み漏れの印なし・呼ばれていません</span></span>
                  <Link href={`/manual/${r.id}`} className="sub" style={{ marginLeft: "auto" }}>開いて確認</Link>
                </label>
              </li>
            ))}
          </ul>
          <button disabled={busy || sel.size === 0} onClick={del} style={{ background: "#c00" }}>チェックした{sel.size}ページを消す</button>
        </div>
      )}
      {(rows ?? []).filter((x) => !x.empty).length > 0 && (
        <div className="card">
          <b>空ではないので、消せないページ</b>
          <ul className="list">
            {(rows ?? []).filter((x) => !x.empty).map((r) => (
              <li key={r.id} style={{ display: "block" }}>
                <b>{r.icon} {r.title}</b>　<Link href={`/manual/${r.id}`} className="sub">開く</Link><br />
                <span className="sub">{r.path || "（いちばん上）"}</span>
                {r.reasons.map((t, i) => <div key={i} className="sub">・{t}</div>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
export default function CleanupPage() { return <MeProvider><Page /></MeProvider>; }
