"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { meetingTabs } from "@/lib/meeting-tabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { reiwa } from "@/lib/era";
import { todayJst } from "@/lib/period-nav";
import type { MeetingKind, MeetingRow, StoreRow } from "@/lib/service";

type Row = Omit<MeetingRow, "transcript" | "minutes" | "mindmap">;

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [kind, setKind] = useState<MeetingKind>("general");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<{ title: string; heldOn: string; attendees: string; agenda: string } | null>(null);
  const [msg, setMsg] = useState("");
  const own = me.level === 4 || storeId === me.storeId;
  const isStylist = me.level >= 3 || me.rank === "stylist";
  // つくれる人: ふつう=店長・正美さんたち／スタイリスト・アシスタントのミーティング=スタイリスト・店長・正美さんたち
  const canEdit = kind === "general" ? me.level === 4 || (me.level === 3 && storeId === me.storeId) : own && isStylist;
  const canDelete = me.level === 4 || (me.level === 3 && storeId === me.storeId);
  const showKinds: [MeetingKind, string][] = [["general", "会議の記録"], ["stylist", "👔 スタイリストミーティング"], ["assistant", "🌱 アシスタントミーティング"]];

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);
  const load = useCallback(async () => {
    try { setRows((await api<{ meetings: Row[] }>(`/api/meetings?storeId=${storeId}&kind=${kind}`)).meetings); setMsg(""); } catch (e) { setRows(null); setMsg((e as Error).message); }
  }, [storeId, kind]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const create = async () => {
    if (!form) return;
    try { const r = await api<{ id: string }>("/api/meetings", { action: "create", storeId, kind, ...form }); location.href = `/meetings/${r.id}`; } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>🎙 ミーティング</h1>
      <SubTabs items={meetingTabs(!!me.appOwner)} />
      <p className="sub">会議のボイスメモから、文字起こし・議事録・要約・マインドマップをつくります。課題をAIに会議してもらうのは、上の「AI会議」です。</p>
      {me.level === 4 && <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 10 }}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
      <div className="toolbar" style={{ flexWrap: "wrap" }}>{showKinds.map(([k, l]) => <button key={k} className={k === kind ? undefined : "ghost"} style={k === kind ? undefined : { border: "1px solid var(--line, #ccc)" }} onClick={() => { setKind(k); setForm(null); }}>{l}</button>)}</div>
      {kind === "stylist" && <p className="sub">スタイリストだけが見られる会議です（そのお店のスタイリストと店長、正美さんたち）。</p>}
      {kind === "assistant" && <p className="sub">スタイリストが、事前に「話し合うこと」を決めておきます。アシスタントは、それを見ながら話して、文字起こし・議事録を残せます。</p>}
      {msg && <p className="err">{msg}</p>}
      {canEdit && !form && <button onClick={() => setForm({ title: "", heldOn: todayJst(), attendees: "", agenda: "" })}>＋ 新しい会議</button>}
      {form && (
        <div className="card" style={{ margin: "10px 0" }}>
          <input placeholder="会議の名前（例：10月の全体ミーティング）" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label>日付<input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
          <input placeholder="参加した人（例：川本、白星、…）" value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} />
          {kind === "assistant" && <label>話し合うこと（アシスタントが、これを見ながら話します）<textarea rows={5} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} placeholder={"例：\n・今月のシャンプーの練習の進み具合\n・先輩に聞きたいこと\n・お客様への声かけで困っていること"} /></label>}
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
              {!m.summary && m.agenda && <div className="sub" style={{ whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>話し合うこと：{m.agenda.slice(0, 100)}</div>}
            </Link>
            {canDelete && <button className="ghost noprint" style={{ color: "#c00", marginTop: 6 }} onClick={async () => { if (!confirm(`「${m.title}」の会議の記録を消しますか？（一覧から見えなくなります）`)) return; try { await api("/api/meetings", { action: "delete", id: m.id }); await load(); } catch (e) { setMsg((e as Error).message); } }}>この会議を消す</button>}
          </li>
        ))}
      </ul>
    </main>
  );
}
export default function MeetingsPage() { return <MeProvider><Page /></MeProvider>; }
