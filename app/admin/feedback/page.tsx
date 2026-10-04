"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAutoRefresh } from "@/lib/client";
import type { FeedbackRow } from "@/lib/service";

const ST = { new: "新しい", read: "読んだ", done: "対応した" } as const;

export default function FeedbackBox() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<FeedbackRow[]>("/api/feedback").then(setRows).catch((e) => setMsg((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  const upd = async (id: string, b: { status?: string; reply?: string }) => { try { await api("/api/feedback", { id, ...b }); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <>
      <h1>届いたご要望</h1>
      <p className="hint">みんなから届いた「こうしてほしい」です。この画面は、アプリ制作者だけが見られます。（新しい：{rows.filter((r) => r.status === "new").length}件）</p>
      {rows.length === 0 && <p className="hint">まだ届いていません。</p>}
      {rows.map((f) => (
        <div key={f.id} className="card" style={{ marginBottom: 10, borderLeft: f.status === "new" ? "4px solid var(--blue)" : undefined }}>
          <div className="sub">{f.createdAt.slice(0, 16)}　<b>{f.fromName}</b>　［{ST[f.status]}］</div>
          <p style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{f.body}</p>
          {f.reply && <p className="hint" style={{ whiteSpace: "pre-wrap" }}>💬 返事：{f.reply}</p>}
          <textarea rows={2} style={{ width: "100%" }} placeholder="返事を書く（本人にお知らせが届きます）" value={reply[f.id] ?? ""} onChange={(e) => setReply({ ...reply, [f.id]: e.target.value })} />
          <div className="actions">
            <button style={{ width: "auto" }} disabled={!(reply[f.id] ?? "").trim()} onClick={async () => { await upd(f.id, { reply: reply[f.id], status: "read" }); setReply({ ...reply, [f.id]: "" }); }}>返事を送る</button>
            {f.status !== "read" && <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={() => upd(f.id, { status: "read" })}>読んだ</button>}
            {f.status !== "done" && <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={() => upd(f.id, { status: "done" })}>対応した</button>}
          </div>
        </div>
      ))}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
