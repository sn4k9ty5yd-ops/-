"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import type { FeedbackRow, Me } from "@/lib/service";

type Msg = { role: "user" | "assistant"; content: string };
const HIDE = ["/login", "/setup", "/security"];
const EXAMPLES = ["休みを出したい", "出勤簿の休憩を直したい", "棚卸しのやり方", "パスコードを変えたい"];

/** 右下の「？」ボタン。押すと、何でも聞けるアシスタントが開く（やり方を答える）。ご要望を送ることもできる */
export function Assistant() {
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ask" | "wish">("ask");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [wish, setWish] = useState(""); const [wishMsg, setWishMsg] = useState("");
  const [mine, setMine] = useState<FeedbackRow[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!HIDE.includes(path)) api<Me>("/api/me").then(setMe).catch(() => setMe(null)); else setMe(null); }, [path]);
  useEffect(() => { const last = msgs[msgs.length - 1]; if (last?.role === "assistant") document.getElementById("asst-last")?.scrollIntoView({ block: "start" }); else end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open, tab]);
  const loadMine = useCallback(() => api<FeedbackRow[]>("/api/feedback").then(setMine).catch(() => {}), []);
  useEffect(() => { if (open && tab === "wish") loadMine(); }, [open, tab, loadMine]);

  if (!me || me.displayOnly || HIDE.includes(path) || typeof document === "undefined") return null;

  const ask = async (q: string) => {
    q = q.trim(); if (!q || busy) return;
    const history = msgs.slice(-6);
    setMsgs((m) => [...m, { role: "user", content: q }]); setText(""); setBusy(true);
    try { const r = await api<{ answer: string }>("/api/assistant", { question: q, history }); setMsgs((m) => [...m, { role: "assistant", content: r.answer }]); }
    catch (e) { setMsgs((m) => [...m, { role: "assistant", content: (e as Error).message }]); }
    setBusy(false);
  };
  const sendWish = async () => {
    try { await api("/api/feedback", { body: wish }); setWish(""); setWishMsg("送りました。ありがとうございます！"); await loadMine(); } catch (e) { setWishMsg((e as Error).message); }
  };

  return createPortal(
    <div className="noprint">
      {!open && <button className="asst-fab" aria-label="わからないことを聞く" onClick={() => setOpen(true)}>？</button>}
      {open && (
        <div className="asst">
          <div className="asst-head">
            <b>わからないことは、聞いてね</b>
            <button className="asst-x" aria-label="閉じる" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="seg" style={{ margin: "0 12px 8px" }}>
            <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>聞く</button>
            <button className={tab === "wish" ? "on" : ""} onClick={() => setTab("wish")}>ご要望・困りごと</button>
          </div>
          {tab === "ask" ? (
            <>
              <div className="asst-body">
                {msgs.length === 0 && (
                  <div>
                    <p className="sub" style={{ margin: "0 0 8px" }}>このアプリの使い方を、なんでも聞いてください。たとえば：</p>
                    <div className="asst-ex">{EXAMPLES.map((x) => <button key={x} onClick={() => ask(x)}>{x}</button>)}</div>
                  </div>
                )}
                {msgs.map((m, i) => <div key={i} id={i === msgs.length - 1 ? "asst-last" : undefined} className={`asst-m ${m.role}`}>{m.content}</div>)}
                {busy && <div className="asst-m assistant">考えています…</div>}
                <div ref={end} />
              </div>
              <form className="asst-in" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="聞きたいことを書く" maxLength={500} aria-label="聞きたいこと" />
                <button type="submit" disabled={busy || !text.trim()}>送る</button>
              </form>
            </>
          ) : (
            <div className="asst-body">
              <p className="sub" style={{ margin: "0 0 6px" }}>「ここが使いにくい」「こんな機能がほしい」など、なんでも書いてください。アプリを作っている人に、直接届きます（ほかの人には見えません）。</p>
              <textarea value={wish} onChange={(e) => setWish(e.target.value)} rows={4} maxLength={2000} style={{ width: "100%", fontSize: 16 }} placeholder="例：売上の画面に、先月との比べも出してほしい" />
              <button disabled={!wish.trim()} onClick={sendWish}>送る</button>
              {wishMsg && <p className="hint">{wishMsg}</p>}
              {mine.length > 0 && (
                <>
                  <b style={{ fontSize: 14 }}>自分が送ったもの</b>
                  <ul className="list">
                    {mine.map((f) => (
                      <li key={f.id} style={{ display: "block" }}>
                        <div className="sub">{f.createdAt.slice(0, 16)}　{({ new: "届きました", read: "読みました", done: "対応しました" } as const)[f.status]}</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{f.body}</div>
                        {f.reply && <div className="card" style={{ marginTop: 6 }}><b>返事：</b>{f.reply}</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>, document.body);
}
