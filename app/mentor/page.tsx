"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useMe } from "@/lib/client";
import { MBTI_TYPES, MENTOR_OPENER } from "@/lib/mentor";
import { mentorTabs } from "@/lib/mentor-tabs";
import type { MentorMessage, MentorSessionRow } from "@/lib/service";

interface State { mbti: string | null; sessionId: string; messages: MentorMessage[]; sessions: MentorSessionRow[]; aiAvailable: boolean }

function Page() {
  const { me } = useMe();
  const [st, setSt] = useState<State | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (session?: string) => {
    try { const r = await api<State>(`/api/mentor${session ? `?session=${session}` : ""}`); setSt(r); setSid(r.sessionId); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [st?.messages.length, pending, busy]);

  const send = async () => {
    const t = text.trim(); if (!t || !sid || busy) return;
    if (!st?.aiAvailable) { setMsg("メンター（AI）は、いま準備中で、まだ返事ができません。準備ができたら、話せるようになります。"); return; }
    setBusy(true); setPending(t); setText(""); setMsg("");
    try { await api("/api/mentor", { action: "send", sessionId: sid, text: t }); await load(sid); } catch (e) { setMsg((e as Error).message); setText(t); }
    setPending(null); setBusy(false);
  };
  if (!st) return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>メンター</h1>{msg && <p className="err">{msg}</p>}</main>;

  const bubble = (mine: boolean, body: string, key: string | number) => (
    <div key={key} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", margin: "8px 0" }}>
      <div style={{ maxWidth: "82%", padding: "10px 14px", borderRadius: 18, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, background: mine ? "var(--blue, #2563eb)" : "var(--card, #fff)", color: mine ? "#fff" : "var(--ink)", border: mine ? "none" : "1px solid var(--line, #e5e5e5)", borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4 }}>{body}</div>
    </div>
  );

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>メンター</h1>
      <SubTabs items={mentorTabs(me.displayOnly, me.rank)} />

      <div className="card" style={{ marginBottom: 10 }}>
        <label style={{ margin: 0 }}><b>あなたのMBTI</b>（最初に入れてね。その人に合わせて話します）
          <select value={st.mbti ?? ""} onChange={async (e) => { try { await api("/api/mentor", { action: "mbti", mbti: e.target.value || null }); await load(sid ?? undefined); } catch (er) { setMsg((er as Error).message); } }}>
            <option value="">まだ決めていない・わからない</option>
            {MBTI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {!st.mbti && <p className="sub" style={{ margin: "6px 0 0" }}>わからないときは、「16Personalities」などの無料の診断で調べられます。</p>}
        <p className="sub" style={{ margin: "6px 0 0" }}>※ 入れたMBTIは、同じお店のみんなと、スタイリストが見られます（会話の内容は、見えません）。</p>
      </div>

      <div className="toolbar">
        <button className="ghost" onClick={() => { const n = crypto.randomUUID(); setSid(n); setSt({ ...st, sessionId: n, messages: [] }); }}>＋ 新しい相談</button>
        {st.sessions.length > 0 && (
          <select aria-label="これまでの相談" value={st.sessions.some((s) => s.sessionId === sid) ? sid ?? "" : ""} onChange={(e) => e.target.value && load(e.target.value)}>
            <option value="">これまでの相談</option>
            {st.sessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.last.slice(5, 10).replace("-", "/")}　{(s.first ?? "").slice(0, 16)}</option>)}
          </select>
        )}
        {st.messages.length > 0 && <button className="ghost" style={{ color: "#c00" }} onClick={async () => { if (!confirm("この相談を、削除しますか？（もとには戻せません）")) return; await api("/api/mentor", { action: "delete", sessionId: sid }); const n = crypto.randomUUID(); setSid(n); await load(); }}>この相談を消す</button>}
      </div>

      {!st.aiAvailable && <p className="hint">いまは、メンター（AI）の準備中です。準備ができると、話せるようになります。</p>}
      {msg && <p className="err">{msg}</p>}

      <div style={{ minHeight: 240 }}>
        {st.messages.length === 0 && !pending && bubble(false, MENTOR_OPENER, "opener")}
        {st.messages.map((m) => bubble(m.role === "user", m.content, m.id))}
        {pending && bubble(true, pending, "pending")}
        {busy && bubble(false, "…", "typing")}
        <div ref={endRef} />
      </div>

      <div style={{ position: "sticky", bottom: 8, background: "var(--card, #fff)", border: "1px solid var(--line, #e5e5e5)", borderRadius: 18, padding: 8, display: "flex", gap: 8, alignItems: "flex-end", boxShadow: "0 4px 18px rgba(0,0,0,.12)" }}>
        <textarea rows={2} value={text} placeholder="なんでも話してみて" style={{ flex: 1, margin: 0, border: "none", resize: "none" }} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
        <button disabled={busy || !text.trim()} onClick={send} style={{ width: "auto", margin: 0 }}>送る</button>
      </div>
    </main>
  );
}
export default function MentorPage() { return <MeProvider><Page /></MeProvider>; }
