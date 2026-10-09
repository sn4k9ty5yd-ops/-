"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, MeProvider } from "@/lib/client";
import { reiwa } from "@/lib/era";
import { discussionPrompt, minutesPrompt, mindmapPrompt, parseMindmap, summaryPrompt, type MindNode } from "@/lib/meeting-prompts";
import type { MeetingAiRow, MeetingRow } from "@/lib/service";
import { MindMap } from "../MindMap";
import { VoiceRecorder } from "../VoiceRecorder";

type Tab = "transcript" | "minutes" | "summary" | "mindmap";
type TextKey = "transcript" | "minutes" | "summary";
interface Detail { meeting: MeetingRow; discussions: MeetingAiRow[]; canEdit: boolean; aiStatus: { available: boolean; provider: string | null } }
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
const TABS: [Tab, string][] = [["transcript", "文字起こし"], ["minutes", "議事録"], ["summary", "要約"], ["mindmap", "マインドマップ"]];

function Page() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("transcript");
  const [live, setLive] = useState(""); const [recording, setRecording] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState<Record<TextKey, string>>({ transcript: "", minutes: "", summary: "" });
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const [theme, setTheme] = useState("");
  const [paste, setPaste] = useState(""); const [pasteMap, setPasteMap] = useState("");
  const timers = useRef<Partial<Record<string, ReturnType<typeof setTimeout>>>>({});
  const first = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>(`/api/meetings?id=${id}`);
      setD(r);
      if (first.current) { first.current = false; setText({ transcript: r.meeting.transcript, minutes: r.meeting.minutes, summary: r.meeting.summary }); }
      setMsg("");
    } catch (e) { setMsg((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { Object.values(timers.current).forEach((t) => t && clearTimeout(t)); }, []);

  const save = useCallback(async (patch: Record<string, string>) => {
    try { await api("/api/meetings", { action: "update", id, ...patch }); setSaved("保存しました"); } catch (e) { setMsg((e as Error).message); setSaved(""); }
  }, [id]);
  const edit = (k: TextKey, v: string) => {
    setText((t) => ({ ...t, [k]: v })); setSaved("入力中…");
    if (timers.current[k]) clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => save({ [k]: v }), 1500);
  };
  const append = (k: TextKey, add: string) => {
    setText((t) => { const v = t[k] ? `${t[k]}\n${add}` : add; if (timers.current[k]) clearTimeout(timers.current[k]); setSaved("入力中…"); timers.current[k] = setTimeout(() => save({ [k]: v }), 1500); return { ...t, [k]: v }; });
  };

  useEffect(() => { if (recording && taRef.current) taRef.current.scrollTop = taRef.current.scrollHeight; }, [recording, live, text.transcript]);
  if (!d) return <main className="wide"><Link href="/meetings" className="back">← 会議の一覧</Link>{msg ? <p className="err">{msg}</p> : null}</main>;
  const m = d.meeting; const canEdit = d.canEdit; const aiOn = d.aiStatus.available;
  const source = text.minutes.trim() || text.transcript.trim();
  const tree: MindNode | null = (() => { try { return m.mindmap ? (JSON.parse(m.mindmap) as MindNode) : null; } catch { return null; } })();

  const runAi = async (kind: string, theme_?: string) => {
    setBusy(kind); setMsg(""); setOk("");
    try {
      await save({ transcript: text.transcript, minutes: text.minutes });         // 先に、いまの内容を保存する
      const r = await api<{ text: string }>("/api/meetings", { action: "ai", id, kind, theme: theme_ });
      if (kind === "minutes") setText((t) => ({ ...t, minutes: r.text }));
      if (kind === "summary") setText((t) => ({ ...t, summary: r.text }));
      if (kind === "theme") setTheme(r.text);
      if (kind === "discussion") setOk("AI会議が終わりました");
      await load();
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  const copyPrompt = async (p: string) => setOk((await copyText(p)) ? "指示文をコピーしました。ChatGPTなどのAIに貼って使ってください" : "コピーできませんでした");

  const Ai = ({ kind, label, prompt, need }: { kind: string; label: string; prompt: string; need: boolean }) => (
    <div className="toolbar noprint">
      {aiOn ? <button disabled={!!busy || !canEdit || !need} onClick={() => runAi(kind)}>{busy === kind ? "AIが作っています…" : `✨ ${label}`}</button> : null}
      <button className="ghost" disabled={!need} onClick={() => copyPrompt(prompt)}>{aiOn ? "指示文だけコピー" : "📋 指示文をコピー（ほかのAI用）"}</button>
    </div>
  );

  return (
    <main className="wide">
      <Link href="/meetings" className="back noprint">← 会議の一覧</Link>
      <h1 style={{ marginBottom: 2 }}>{m.title}</h1>
      <p className="sub" style={{ margin: 0 }}>{reiwa(m.heldOn)}{m.attendees ? `　参加：${m.attendees}` : ""}{canEdit ? "" : "　（見るだけ）"}　<span>{saved}</span></p>
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub">{ok}</p>}
      {!aiOn && <p className="hint noprint">いまは、AIの自動作成はまだ使えません（管理者がカギを設定すると使えます）。ボイスメモの文字起こしは使えます。議事録・要約・マインドマップは、「指示文をコピー」して、ほかのAIに貼って作れます。</p>}

      <div className="seg noprint" style={{ flexWrap: "wrap" }}>{TABS.map(([t, l]) => <button key={t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setOk(""); }}>{l}</button>)}</div>

      {tab === "transcript" && (
        <>
          {canEdit && <VoiceRecorder onFinal={(t) => t && append("transcript", t)} onInterim={setLive} onState={(v) => { setRecording(v); if (!v) setLive(""); }} />}
          <textarea ref={taRef} rows={14} value={recording && live ? `${text.transcript}${text.transcript ? "\n" : ""}${live}` : text.transcript} readOnly={!canEdit || recording} placeholder="ここに、文字起こしが入ります。手で入れたり、貼りつけたり、直したりもできます。" onChange={(e) => edit("transcript", e.target.value)} style={recording ? { background: "#fff8f0" } : undefined} />
          <p className="sub">{text.transcript.length.toLocaleString("ja-JP")}文字</p>
        </>
      )}

      {tab === "minutes" && (
        <>
          <Ai kind="minutes" label="AIで議事録をつくる" prompt={minutesPrompt(text.transcript, m.title, m.heldOn, m.attendees)} need={!!text.transcript.trim()} />
          <textarea rows={18} value={text.minutes} readOnly={!canEdit} placeholder="議事録（会議名・議題・決まったこと・やること など）。AIでつくるか、ほかのAIの答えを貼りつけます。" onChange={(e) => edit("minutes", e.target.value)} />
          <div className="toolbar noprint"><button className="ghost" onClick={async () => setOk((await copyText(text.minutes)) ? "議事録をコピーしました" : "コピーできませんでした")}>議事録をコピー</button><button className="ghost" onClick={() => window.print()}>印刷</button></div>
        </>
      )}

      {tab === "summary" && (
        <>
          <Ai kind="summary" label="AIで要約する" prompt={summaryPrompt(source)} need={!!source} />
          <textarea rows={14} value={text.summary} readOnly={!canEdit} placeholder="要約（ひとこと・大事なポイント・決まったこと・やること・課題）" onChange={(e) => edit("summary", e.target.value)} />
        </>
      )}

      {tab === "mindmap" && (
        <>
          <Ai kind="mindmap" label="AIでマインドマップをつくる" prompt={mindmapPrompt(source)} need={!!source} />
          {tree ? <MindMap tree={tree} name={m.title} /> : <p className="hint">まだマインドマップがありません。</p>}
          {canEdit && !aiOn && (
            <details className="noprint" style={{ marginTop: 10 }}><summary>ほかのAIの答え（JSON）を貼りつけて読み込む</summary>
              <textarea rows={6} value={pasteMap} onChange={(e) => setPasteMap(e.target.value)} placeholder='{"title":"…","children":[…]}' />
              <button disabled={!pasteMap.trim()} onClick={async () => { const t = parseMindmap(pasteMap); if (!t) { setMsg("読み取れませんでした。AIの答え（{ から } まで）をそのまま貼ってください"); return; } await save({ mindmap: JSON.stringify(t) }); setPasteMap(""); await load(); }}>読み込む</button>
            </details>
          )}
        </>
      )}

      {canEdit && <p className="noprint" style={{ marginTop: 24 }}><button className="ghost" style={{ color: "#c00" }} onClick={async () => { if (!confirm("この会議の記録を削除しますか？（一覧から見えなくなります）")) return; try { await api("/api/meetings", { action: "delete", id }); location.href = "/meetings"; } catch (e) { setMsg((e as Error).message); } }}>この会議を削除</button></p>}
    </main>
  );
}
export default function MeetingPage() { return <MeProvider><Page /></MeProvider>; }
