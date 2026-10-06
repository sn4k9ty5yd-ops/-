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
          <b>いまの状態：</b>{st.available ? "🔑 カギが入っています（動くかどうかは、「ためす」で確かめます）" : "⚪ まだ準備中（カギがありません）"}
          {st.available && <div className="sub">{st.provider === "gemini" ? "Google（Gemini）" : "Claude"}　／　{st.source === "screen" ? `この画面で入れたカギ（${st.masked}）` : "サーバーの設定のカギ"}{st.updatedAt ? `　${st.updatedAt.slice(0, 16)}` : ""}</div>}
        </div>
      )}
      {st && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>AIの種類</h2>
          <p className="hint" style={{ margin: "0 0 8px" }}>どちらを使うか、えらべます。えらぶと、すぐに切りかわります。</p>
          <div className="seg">
            <button className={st.tier !== "pro" ? "on" : ""} disabled={busy} onClick={() => run({ action: "tier", tier: "flash" }, "「速い・安い」に切りかえました")}>⚡ 速い・安い（flash）</button>
            <button className={st.tier === "pro" ? "on" : ""} disabled={busy} onClick={() => run({ action: "tier", tier: "pro" }, "「高性能（pro）」に切りかえました。「ためす」で確かめてください")}>🧠 高性能（pro）</button>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>高性能（pro）は、答えがくわしく賢くなりますが、時間がかかり、使った分のお金も高くなります。Googleで課金（支払いの設定）をしたカギで使ってください。課金していないカギでは、使えないか、すぐ回数の上限に達することがあります。</p>
        </div>
      )}
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>課金（有料）で使うには</h2>
        <p className="sub">GeminiアプリのProの契約と、このアプリで使うAIの料金は、別々です。このアプリ用の支払いを、別に設定します。</p>
        <ol style={{ lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Google AI Studio（aistudio.google.com）を開き、カギの一覧（「API keys」）を開きます。</li>
          <li>使っているカギの横の「Set up billing」（支払いの設定）を押し、画面のとおりに、支払い方法を登録します。</li>
          <li>登録が終わると、そのカギは、課金の枠（回数の上限が大きい枠）になります。アプリ側の操作は、いりません。</li>
          <li>上の「AIの種類」で、「高性能（pro）」を選んで、「ためす」を押します。</li>
        </ol>
        <p className="hint">料金は、使った分だけです。このアプリの使い方（会議・占い・チャットなど）なら、ふつうは月に数百円〜数千円のことが多いです。Googleの支払い画面で、「予算のお知らせ（上限の通知）」を設定しておくと安心です。</p>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>カギを入れる・入れかえる</h2>
        <ol style={{ lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Google AI Studio（aistudio.google.com）を開き、「Get API key」→「APIキーを作成」で、カギを作ります。</li>
          <li>出てきた長い文字（「AIza」「AQ.」「AS」などで始まります）を、まるごとコピーします。</li>
          <li>下の欄に貼って、「保存する」を押します。</li>
          <li>「ためす」を押して、「AIから返事が来ました」と出れば完了です。</li>
        </ol>
        <input type="password" autoComplete="off" placeholder="ここにカギを貼る" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: "100%" }} />
        <div className="actions">
          <button style={{ width: "auto" }} disabled={busy || key.trim().length < 20} onClick={() => run({ action: "save", key }, "保存しました。「ためす」を押して、確かめてください")}>保存する</button>
          <button className="ghost" style={{ width: "auto", color: "var(--blue)" }} disabled={busy || !st?.available} onClick={() => run({ action: "test" }, "")}>ためす</button>
          {st?.source === "screen" && <button className="ghost" style={{ width: "auto", color: "#b91c1c" }} disabled={busy} onClick={() => { if (confirm("この画面で入れたカギを、消しますか？（消すと、AIは使えなくなります）")) run({ action: "clear" }, "カギを消しました"); }}>カギを消す</button>}
        </div>
        {msg && <p className="sub" style={{ whiteSpace: "pre-wrap" }}><b>{msg}</b></p>}
        <p className="hint">※ 保存したカギは、アプリの中のデータベースにだけ入り、画面には先頭と最後の4文字しか出ません。ほかの人には、この画面もカギも見えません。</p>
      </div>
    </>
  );
}
