"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { meetingTabs } from "@/lib/meeting-tabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { reiwa } from "@/lib/era";
import { todayJst } from "@/lib/period-nav";
import type { MeetingRow, StoreRow } from "@/lib/service";

type Row = Omit<MeetingRow, "transcript" | "minutes" | "mindmap">;

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<{ title: string; heldOn: string; attendees: string } | null>(null);
  const [msg, setMsg] = useState("");
  const canEdit = me.level === 4 || (me.level === 3 && storeId === me.storeId);

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);
  const load = useCallback(async () => {
    try { setRows((await api<{ meetings: Row[] }>(`/api/meetings?storeId=${storeId}`)).meetings); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const create = async () => {
    if (!form) return;
    try { const r = await api<{ id: string }>("/api/meetings", { action: "create", storeId, ...form }); location.href = `/meetings/${r.id}`; } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>🎙 議事録</h1>
      <SubTabs items={meetingTabs(!!me.appOwner)} />
      <p className="sub">会議のボイスメモから、文字起こし・議事録・要約・マインドマップをつくります。（課題をAIに会議してもらうのは、上の「AI会議」です）</p>
      {me.level === 4 && <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 10 }}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
      {msg && <p className="err">{msg}</p>}
      {canEdit && !form && <button onClick={() => setForm({ title: "", heldOn: todayJst(), attendees: "" })}>＋ 新しい会議</button>}
      {form && (
        <div className="card" style={{ margin: "10px 0" }}>
          <input placeholder="会議の名前（例：10月の全体ミーティング）" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label>日付<input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
          <input placeholder="参加した人（例：川本、白星、…）" value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} />
          <div className="toolbar"><button disabled={!form.title.trim()} onClick={create}>つくって、はじめる</button><button className="ghost" onClick={() => setForm(null)}>やめる</button></div>
        </div>
      )}
      {rows && rows.length === 0 && <p className="hint">まだ会議の記録がありません。{canEdit ? "「＋ 新しい会議」から、はじめられます。" : ""}</p>}
      <ul className="list">
        {(rows ?? []).map((m) => (
          <li key={m.id} style={{ display: "block" }}>
            <Link href={`/meetings/${m.id}`} style={{ textDecoration: "none", color: "var(--ink)", display: "block" }}>
              <b>{m.title}</b>　<span className="sub">{reiwa(m.heldOn)}</span>
              {m.summary && <div className="sub" style={{ whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>{m.summary.slice(0, 120)}</div>}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
export default function MeetingsPage() { return <MeProvider><Page /></MeProvider>; }
