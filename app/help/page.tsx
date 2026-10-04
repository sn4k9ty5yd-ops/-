"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import { GLOSSARY, HELP, HELP_INTRO } from "@/lib/help";
import type { FeedbackRow } from "@/lib/service";

const ST = { new: "届きました", read: "読みました", done: "対応しました" } as const;

function Inner() {
  const { me } = useMe();
  const [mine, setMine] = useState<FeedbackRow[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api<FeedbackRow[]>("/api/feedback").then(setMine).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const topics = HELP.filter((t) => me.level >= (t.min ?? 1) && (t.flag !== "material" || me.level === 4 || !!me.materialManager) && (t.flag !== "edu" || me.level >= 3 || !!me.eduLead));
  const send = async () => {
    try { await api("/api/feedback", { body: text }); setText(""); setMsg("送りました。ありがとうございます！"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <main style={{ maxWidth: 760 }}>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>ヘルプ</h1>
      <p className="hint">{HELP_INTRO}</p>
      <p className="sub">いまの自分（{me.name}）が使える機能だけを出しています。</p>
      <details className="card" style={{ marginBottom: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 17 }}><b>🔰 はじめに：言葉の説明</b></summary>
        <dl style={{ lineHeight: 1.8 }}>{GLOSSARY.map(([k, v]) => <div key={k} style={{ marginBottom: 6 }}><dt><b>{k}</b></dt><dd style={{ margin: "0 0 0 1em" }}>{v}</dd></div>)}</dl>
      </details>
      <nav className="actions" style={{ flexWrap: "wrap", margin: "8px 0 16px" }}>
        {topics.map((t) => <a key={t.id} href={`#h-${t.id}`} onClick={() => setOpen(t.id)} className="badge2" style={{ textDecoration: "none" }}>{t.icon} {t.title.split("（")[0]}</a>)}
      </nav>
      {topics.map((t) => (
        <details key={t.id} id={`h-${t.id}`} className="card" style={{ marginBottom: 10 }} open={open === t.id || undefined}>
          <summary style={{ cursor: "pointer", fontSize: 17 }}><b>{t.icon} {t.title}</b> <span className="sub">　使う人：{t.who}</span></summary>
          <p style={{ margin: "6px 0 0" }}>{t.what}</p>
          <ol style={{ lineHeight: 2, paddingLeft: 22, fontSize: 16 }}>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {t.tips && <ul style={{ lineHeight: 1.8 }} className="sub">{t.tips.map((s, i) => <li key={i}>💡 {s}</li>)}</ul>}
        </details>
      ))}

      {!me.displayOnly && (
        <section id="order" className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>💌 このアプリを、もっとこうしてほしい！・困っていること</h2>
          <p className="sub">「ここが使いにくい」「こんな機能がほしい」など、なんでも書いてください。アプリを作っている人に、直接届きます（ほかの人には見えません）。</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} style={{ width: "100%", fontSize: 16 }} placeholder="例：売上の画面に、先月との比べも出してほしい" />
          <button disabled={!text.trim()} onClick={send}>送る</button>
          {msg && <p className="hint">{msg}</p>}
          {mine.length > 0 && (
            <>
              <h3>自分が送ったもの</h3>
              <ul className="list">
                {mine.map((f) => (
                  <li key={f.id} style={{ display: "block" }}>
                    <div className="sub">{f.createdAt.slice(0, 16)}　{ST[f.status]}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{f.body}</div>
                    {f.reply && <div className="hint" style={{ whiteSpace: "pre-wrap" }}>💬 返事：{f.reply}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
export default function HelpPage() { return <MeProvider><Inner /></MeProvider>; }
