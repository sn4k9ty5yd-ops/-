"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { discussionPrompt } from "@/lib/meeting-prompts";
import { meetingTabs } from "@/lib/meeting-tabs";
import type { CouncilRow, StoreRow } from "@/lib/service";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

function View({ priv }: { priv: boolean }) {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [items, setItems] = useState<CouncilRow[] | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [theme, setTheme] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const canRun = priv ? !!me.appOwner : me.level === 4 || (me.level === 3 && storeId === me.storeId);

  useEffect(() => { if (!priv && me.level === 4) api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, [priv, me.level]);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: CouncilRow[]; aiStatus: { available: boolean } }>(priv ? "/api/councils?private=1" : `/api/councils?storeId=${storeId}`);
      setItems(r.items); setAiOn(r.aiStatus.available); setMsg("");
    } catch (e) { setMsg((e as Error).message); }
  }, [priv, storeId]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const run = async (pasteText?: string) => {
    setBusy(true); setMsg(""); setOk("");
    try {
      await api("/api/councils", { action: "run", storeId: priv ? undefined : storeId, private: priv, theme, paste: pasteText });
      setTheme(""); setPaste(""); setOk(pasteText === undefined ? "AI会議が終わりました" : "残しました"); await load();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>{priv ? "🔒 AI会議（僕専用）" : "🤖 ミーティング"}</h1>
      <SubTabs items={meetingTabs(!!me.appOwner)} />
      <p className="sub">{priv ? "あなただけが読める、AI会議です。ほかの人（鬼塚さん・正美さん・店長）には、見えません。" : "課題（テーマ）を入れると、3人の人格が5回会話して、論点・結論・行動計画をまとめます。自分のお店の人は、記録を読めます。"}</p>
      {!priv && me.level === 4 && <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 10 }}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub">{ok}</p>}
      {canRun ? (
        <div className="card" style={{ margin: "10px 0" }}>
          <input value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={200} placeholder="議論のテーマ（例：新人の定着率を上げるには）" />
          <div className="toolbar noprint">
            {aiOn && <button disabled={busy || !theme.trim()} onClick={() => run()}>{busy ? "AIが会議しています…（少し時間がかかります）" : "✨ AI会議をはじめる"}</button>}
            <button className="ghost" disabled={!theme.trim()} onClick={async () => setOk((await copyText(discussionPrompt(theme))) ? "指示文をコピーしました。ChatGPTなどのAIに貼って使ってください" : "コピーできませんでした")}>{aiOn ? "指示文だけコピー" : "📋 指示文をコピー（ほかのAI用）"}</button>
          </div>
          {!aiOn && <p className="hint">いまは、AIの自動の会議はまだ使えません。「指示文をコピー」して、ほかのAIに貼り、結果を下に貼りつけて残せます。</p>}
          {!aiOn && (
            <details><summary>ほかのAIで会議した結果を貼りつけて残す</summary>
              <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="AIの答えを、ここに貼りつけます" />
              <button disabled={busy || !paste.trim() || !theme.trim()} onClick={() => run(paste)}>この結果を残す</button>
            </details>
          )}
          <p className="hint" style={{ margin: "6px 0 0" }}>AIを使うと、テーマの文章が外部のAIのサービス（Google等）に送られます。個人の名前や、お金の細かい数字は、なるべく入れないでください。</p>
        </div>
      ) : <p className="hint">{priv ? "" : "ミーティングをひらけるのは、店長と正美さんです。ここでは記録を読めます。"}</p>}
      {items && items.length === 0 && <p className="hint">まだ記録がありません。</p>}
      {(items ?? []).map((x) => (
        <div key={x.id} className="card" style={{ marginTop: 10 }}>
          <b>テーマ：{x.theme}</b> <span className="sub">{x.createdAt.slice(0, 16)}　{x.byName ?? ""}{x.fromMeeting ? "　（議事録の中でひらいた分）" : ""}</span>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{x.result}</div>
          <div className="toolbar noprint">
            <button className="ghost" onClick={async () => setOk((await copyText(x.result)) ? "コピーしました" : "コピーできませんでした")}>コピー</button>
            {x.mine && <button className="ghost" style={{ color: "#c00" }} onClick={async () => { if (!confirm("この記録を消しますか？（元に戻せません）")) return; try { await api("/api/councils", { action: "delete", id: x.id }); await load(); } catch (e) { setMsg((e as Error).message); } }}>消す</button>}
          </div>
        </div>
      ))}
    </main>
  );
}
export function CouncilPage({ priv }: { priv: boolean }) { return <MeProvider><View priv={priv} /></MeProvider>; }
