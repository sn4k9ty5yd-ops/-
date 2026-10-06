"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { AiSettings } from "@/lib/service";

export default function AiKeyPage() {
  const [st, setSt] = useState<AiSettings | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<AiSettings>("/api/ai-key").then(setSt).catch((e) => setMsg((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);
  const run = async (body: object, ok: string) => {
    setBusy(true); setMsg("");
    try { const r = await api<{ ok?: boolean; message?: string }>("/api/ai-key", body); setMsg(r.message ?? ok); setKey(""); await load(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <h1>AIのカギ</h1>
      <p className="hint">ミーティングのAI・メンターのチャットを動かすための「カギ」を入れる画面です。アプリ制作者だけが見られます。カギは、ここにだけ貼ってください（チャットやメールには貼らないでください）。</p>
      {st && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>いまの状態：</b>{st.available ? "✅ AIが使えます" : "⚪ まだ準備中（カギがありません）"}
          {st.available && <div className="sub">{st.provider === "gemini" ? "Google（Gemini）" : "Claude"}　／　{st.source === "screen" ? `この画面で入れたカギ（${st.masked}）` : "サーバーの設定のカギ"}{st.updatedAt ? `　${st.updatedAt.slice(0, 16)}` : ""}</div>}
        </div>
      )}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>カギを入れる・入れかえる</h2>
        <ol style={{ lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Google AI Studio（aistudio.google.com）を開き、「Get API key」→「APIキーを作成」で、カギを作ります。</li>
          <li>出てきた「AIza」で始まる長い文字を、コピーします。</li>
          <li>下の欄に貼って、「保存する」を押します。</li>
          <li>「ためす」を押して、「AIから返事が来ました」と出れば完了です。</li>
        </ol>
        <input type="password" autoComplete="off" placeholder="ここにカギを貼る（AIza…）" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: "100%" }} />
        <div className="actions">
          <button style={{ width: "auto" }} disabled={busy || key.trim().length < 20} onClick={() => run({ action: "save", key }, "保存しました。「ためす」を押して、確かめてください")}>保存する</button>
          <button className="ghost" style={{ width: "auto", color: "var(--blue)" }} disabled={busy || !st?.available} onClick={() => run({ action: "test" }, "")}>ためす</button>
          {st?.source === "screen" && <button className="ghost" style={{ width: "auto", color: "#b91c1c" }} disabled={busy} onClick={() => { if (confirm("この画面で入れたカギを、消しますか？（消すと、AIは使えなくなります）")) run({ action: "clear" }, "カギを消しました"); }}>カギを消す</button>}
        </div>
        {msg && <p className="sub"><b>{msg}</b></p>}
        <p className="hint">※ 保存したカギは、アプリの中のデータベースにだけ入り、画面には先頭と最後の4文字しか出ません。ほかの人には、この画面もカギも見えません。</p>
      </div>
    </>
  );
}
