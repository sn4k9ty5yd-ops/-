"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { meetingTabs } from "@/lib/meeting-tabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { reiwa } from "@/lib/era";
import { todayJst } from "@/lib/period-nav";
import type { MeetingKind, MeetingRow, NextAgenda, StoreRow } from "@/lib/service";

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
  const canEdit = kind === "general" ? me.level === 4 || (me.level === 3 && storeId === me.storeId) : kind === "assistant" ? own : own && isStylist;
  const canDelete = me.level === 4 || (me.level === 3 && storeId === me.storeId);
  const showKinds: [MeetingKind, string][] = [["general", "🎙 全体"], ["stylist", "👔 スタイリスト"], ["assistant", "🌱 アシスタント"]];

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);
  const load = useCallback(async () => {
    try { setRows((await api<{ meetings: Row[] }>(`/api/meetings?storeId=${storeId}&kind=${kind}`)).meetings); setMsg(""); } catch (e) { setRows(null); setMsg((e as Error).message); }
  }, [storeId, kind]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const [next, setNext] = useState<NextAgenda | null>(null);
  const [nextText, setNextText] = useState<string | null>(null);
  const loadNext = useCallback(async () => { if (kind !== "assistant") return; try { setNext(await api<NextAgenda>(`/api/meetings?next=1&storeId=${storeId}`)); } catch { setNext(null); } }, [kind, storeId]);
  useEffect(() => { setNextText(null); loadNext(); }, [loadNext]);
  useAutoRefresh(loadNext);

  const create = async () => {
    if (!form) return;
    try { const r = await api<{ id: string }>("/api/meetings", { action: "create", storeId, kind, ...form }); location.href = `/meetings/${r.id}`; } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>🎙 ミーティング</h1>
      <SubTabs items={meetingTabs(!!me.appOwner)} />
      <p className="sub">ボイスメモから、文字起こし・議事録・要約・マインドマップをつくります。</p>
      {me.level === 4 && <label style={{ display: "block", marginBottom: 10 }}>お店<select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      <div role="tablist" aria-label="会議の種類" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "4px 0 10px" }}>{showKinds.map(([k, l]) => <button key={k} role="tab" aria-selected={k === kind} className={k === kind ? undefined : "ghost"} style={{ padding: "10px 4px", fontSize: 14, whiteSpace: "nowrap", ...(k === kind ? {} : { border: "1px solid var(--line, #ccc)" }) }} onClick={() => { setKind(k); setForm(null); }}>{l}</button>)}</div>
      {kind === "stylist" && <p className="sub">スタイリストと店長だけが見られます。</p>}
      {kind === "assistant" && <p className="sub">スタイリストが「次のミーティングの議題」を書き、アシスタントはそれを見ながら話して、報告までこの画面で書きます。</p>}
      {kind === "assistant" && next && (
        <div className="card" style={{ margin: "10px 0" }}>
          <b>📌 次のミーティングの議題</b>
          {next.canEdit ? (
            <>
              <p className="sub" style={{ margin: "2px 0" }}>スタイリストが、課題や話し合いたいことを、いつでもここに書けます。アシスタントはこれを見て、ミーティングで話します。</p>
              <textarea rows={6} value={nextText ?? next.body} onChange={(e) => setNextText(e.target.value)} placeholder={"例：\n・シャンプーの練習の進み具合\n・先輩に聞きたいこと\n・お客様への声かけで困っていること"} />
              <div className="toolbar noprint"><button disabled={nextText === null || nextText === next.body} onClick={async () => { try { await api("/api/meetings", { action: "next_agenda", storeId, body: nextText ?? "" }); setNextText(null); setMsg(""); await loadNext(); } catch (e) { setMsg((e as Error).message); } }}>議題を保存</button></div>
            </>
          ) : next.body ? <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{next.body}</div> : <p className="hint">まだ、議題は書かれていません。</p>}
          {next.updatedAt && <p className="sub" style={{ margin: "6px 0 0" }}>{next.byName ?? ""}　{next.updatedAt}</p>}
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
      {canEdit && !form && <button style={{ marginTop: 6 }} onClick={() => setForm({ title: kind === "assistant" ? `${new Date().getMonth() + 1}月のアシスタントミーティング` : "", heldOn: todayJst(), attendees: "", agenda: "" })}>{kind === "assistant" ? "＋ ミーティングの報告をつくる" : "＋ 新しい会議"}</button>}
      {form && (
        <div className="card" style={{ margin: "10px 0" }}>
          <input placeholder="会議の名前（例：10月の全体ミーティング）" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label>日付<input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
          <input placeholder="参加した人（例：川本、白星、…）" value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} />
          {kind === "assistant" && isStylist && <label>この会議だけの、話し合うこと（空なら、上の「次のミーティングの議題」が入ります）<textarea rows={5} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} placeholder={"例：\n・今月のシャンプーの練習の進み具合\n・先輩に聞きたいこと\n・お客様への声かけで困っていること"} /></label>}
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
