"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useMe } from "@/lib/client";
import { compatibility, fortune, zodiacName, zodiacOf } from "@/lib/fortune";
import { FORTUNE_KINDS, fortunePrompt, type FortuneKind } from "@/lib/fortune-ai";
import { MBTI_TYPES } from "@/lib/mentor";
import { mentorTabs } from "@/lib/mentor-tabs";
import { todayJst } from "@/lib/period-nav";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);


/** くわしい占い（四柱推命・六星占術・動物占い）。AIが読む。結果と入力は、この端末にだけ保存する */
function DeepFortune() {
  const [kind, setKind] = useState<FortuneKind>("shichu");
  const [f, setF] = useState({ birth: "", time: "", place: "" });
  const [res, setRes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ai, setAi] = useState<boolean | null>(null);
  const k = FORTUNE_KINDS.find((x) => x.id === kind)!;
  const key = (id: string) => `fortuneAi:${id}:${f.birth}:${id === "shichu" ? f.time + ":" + f.place : ""}`;
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem("fortuneAiInput") ?? "null"); if (v) setF({ birth: v.birth ?? "", time: v.time ?? "", place: v.place ?? "" }); } catch { /* 無視 */ }
    api<{ aiAvailable: boolean }>("/api/mentor/fortune").then((r) => setAi(r.aiAvailable)).catch(() => setAi(false));
  }, []);
  const save = (n: typeof f) => { setF(n); try { localStorage.setItem("fortuneAiInput", JSON.stringify(n)); } catch { /* 無視 */ } };
  const shown = f.birth ? (res[key(kind)] ?? (() => { try { return localStorage.getItem(key(kind)) ?? ""; } catch { return ""; } })()) : "";
  const run = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await api<{ text: string }>("/api/mentor/fortune", { kind, birth: f.birth, time: f.time, place: f.place });
      setRes((o) => ({ ...o, [key(kind)]: r.text }));
      try { localStorage.setItem(key(kind), r.text); } catch { /* 無視 */ }
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const today = todayJst();
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2 style={{ marginTop: 0 }}>🔮 くわしい占い（AI）</h2>
      <p className="sub">四柱推命・六星占術・動物占いを、AIがくわしく読みます。時間がかかることがあります（30秒ほど）。</p>
      <div className="seg">{FORTUNE_KINDS.map((x) => <button key={x.id} className={kind === x.id ? "on" : ""} onClick={() => { setKind(x.id); setMsg(""); }}>{x.icon} {x.title}</button>)}</div>
      <p className="hint" style={{ margin: "8px 0" }}>{k.lead}</p>
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <label>生年月日<input type="date" value={f.birth} max={today} min="1900-01-01" onChange={(e) => save({ ...f, birth: e.target.value })} /></label>
        {k.needTime && <label>生まれた時間（わかれば）<input type="time" value={f.time} onChange={(e) => save({ ...f, time: e.target.value })} /></label>}
        {k.needTime && <label>生まれた場所（わかれば）<input type="text" maxLength={40} placeholder="例：福岡県" value={f.place} onChange={(e) => save({ ...f, place: e.target.value })} /></label>}
      </div>
      <div className="actions">
        <button style={{ width: "auto" }} disabled={busy || !f.birth || ai === false} onClick={run}>{busy ? "占っています…" : shown ? "もう一度占う" : "占う"}</button>
        {f.birth && <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={async () => { try { setMsg((await copyText(fortunePrompt({ kind, birth: f.birth, time: f.time, place: f.place, today }))) ? "指示文をコピーしました。ChatGPTやGeminiなどに貼ると、同じ占いができます" : "コピーできませんでした"); } catch (e) { setMsg((e as Error).message); } }}>📋 指示文をコピー</button>}
      </div>
      {ai === false && <p className="hint">いまは、AIの準備中です。「指示文をコピー」を使って、ほかのAI（ChatGPT・Geminiなど）に貼ると、同じ占いができます。</p>}
      {msg && <p className="sub"><b>{msg}</b></p>}
      {shown && (
        <>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.9, fontSize: 16, marginTop: 10 }}>{shown}</div>
          <div className="actions"><button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={async () => setMsg((await copyText(shown)) ? "結果をコピーしました" : "コピーできませんでした")}>結果をコピー</button></div>
        </>
      )}
      <p className="hint" style={{ marginTop: 10 }}>※ AIが計算して読むので、命式や星の判定が、ずれることがあります。お楽しみ・ヒントとして使ってください。生年月日などは、占いのためだけにAI（Google）へ送られ、サーバーには保存されません。結果は、この端末にだけ保存されます。</p>
    </div>
  );
}

function Page() {
  const { me } = useMe();
  const [mbti, setMbti] = useState<string | null>(null);
  const [bd, setBd] = useState({ m: 0, d: 0 });
  const [other, setOther] = useState("");
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem("fortuneBirthday") ?? "null"); if (v?.m && v?.d) setBd(v); } catch { /* 保存がなくても動く */ }
    api<{ mbti: string | null }>("/api/mentor").then((r) => setMbti(r.mbti)).catch(() => {});
  }, []);
  const set = (b: { m: number; d: number }) => { setBd(b); try { localStorage.setItem("fortuneBirthday", JSON.stringify(b)); } catch { /* 無視 */ } };
  const z = bd.m && bd.d ? zodiacOf(bd.m, bd.d) : null;
  const f = z ? fortune(todayJst(), z, mbti) : null;
  const comp = mbti && other ? compatibility(mbti, other) : null;
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>メンター</h1>
      <SubTabs items={mentorTabs(me.displayOnly, me.rank)} />
      <p className="sub">ちょっとした占いです。お楽しみで、気軽にどうぞ。毎日かわります。</p>
      <div className="card" style={{ marginBottom: 10 }}>
        <b>誕生日（星座を決めるために使います。この端末にだけ保存されます）</b>
        <div className="toolbar">
          <select aria-label="月" value={bd.m} onChange={(e) => set({ ...bd, m: Number(e.target.value) })}><option value={0}>月</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}月</option>)}</select>
          <select aria-label="日" value={bd.d} onChange={(e) => set({ ...bd, d: Number(e.target.value) })}><option value={0}>日</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}日</option>)}</select>
          {z && <span className="chip">{zodiacName(z)}</span>}
          {mbti && <span className="chip">{mbti}</span>}
        </div>
        {!mbti && <p className="sub" style={{ margin: "6px 0 0" }}>MBTIを入れると、結果がもっとあなたらしくなります（「チャット」で入れられます）。</p>}
      </div>
      {f ? (
        <div className="card">
          <div className="sub">今日の運勢</div>
          <div style={{ fontSize: 28, color: "#f5a623", letterSpacing: 2 }}>{stars(f.stars.total)}</div>
          <p style={{ fontSize: 18, fontWeight: 700 }}>{f.message}</p>
          <table className="tbl"><tbody>
            <tr><td>仕事運</td><td style={{ color: "#f5a623" }}>{stars(f.stars.work)}</td></tr>
            <tr><td>人間関係</td><td style={{ color: "#f5a623" }}>{stars(f.stars.people)}</td></tr>
            <tr><td>技術運</td><td style={{ color: "#f5a623" }}>{stars(f.stars.skill)}</td></tr>
          </tbody></table>
          <p>🎨 ラッキーカラー：<b>{f.luckyColor}</b>　🧰 ラッキーアイテム：<b>{f.luckyItem}</b>　🔢 ラッキーナンバー：<b>{f.luckyNumber}</b></p>
          <p className="sub">ひとこと：{f.advice}</p>
        </div>
      ) : <p className="hint">誕生日を入れると、今日の運勢が出ます。</p>}
      <div className="card" style={{ marginTop: 10 }}>
        <b>MBTIの相性</b>
        {!mbti ? <p className="sub">自分のMBTIを入れると、相性が見られます。</p> : (
          <>
            <select value={other} onChange={(e) => setOther(e.target.value)}><option value="">あいてのMBTIをえらぶ</option>{MBTI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            {comp && <p><b style={{ fontSize: 24 }}>{mbti} × {other}　{comp.score}%</b><br />{comp.comment}</p>}
          </>
        )}
      </div>
      <DeepFortune />
    </main>
  );
}
export default function FortunePage() { return <MeProvider><Page /></MeProvider>; }
