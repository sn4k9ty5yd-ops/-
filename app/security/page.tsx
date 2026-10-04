"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import type { SecurityOverview } from "@/lib/service";

const when = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const device = (ua: string | null) => (!ua ? "" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "その他");
const ACTION: Record<string, string> = { "staff.create": "スタッフを登録", "staff.update": "レベル・在籍を変更" };

function Page() {
  const { me } = useMe();
  const [d, setD] = useState<SecurityOverview | null>(null);
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setD(await api<SecurityOverview>("/api/security")); } catch (e) { setMsg((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);

  const change = async () => {
    setMsg(""); setOk("");
    if (n1 !== n2) { setMsg("新しいパスコードが、2回で一致しません"); return; }
    setBusy(true);
    try { await api("/api/security", { action: "change", current: cur, next: n1 }); setOk("パスコードを変えました。ほかの端末は、ログアウトされました。"); setCur(""); setN1(""); setN2(""); await load(); if (d?.mustChange) location.href = "/home"; }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const others = async () => { try { const r = await api<{ count: number }>("/api/security", { action: "logout-others" }); setOk(`ほかの端末 ${r.count} 台を、ログアウトしました`); } catch (e) { setMsg((e as Error).message); } };

  return (
    <main className="wide">
      {!d?.mustChange && <Link href="/home" className="back">← ホーム</Link>}
      <h1>セキュリティ</h1>
      {d?.mustChange && <div className="card" style={{ background: "#fff1cc", borderColor: "#ffd166" }}><b>🔐 最初に、あなただけのパスコードに変えてください</b><p className="sub" style={{ margin: "6px 0 0" }}>いまのパスコードは、オフィスが発行したものです。ほかの人に知られないように、自分だけのものに変えると、アプリを使えるようになります。</p></div>}
      <div className="card">
        <b>パスコードを変える</b>
        <label>いまのパスコード<input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ""))} /></label>
        <label>新しいパスコード（6けたの数字）<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={n1} onChange={(e) => setN1(e.target.value.replace(/\D/g, ""))} /></label>
        <label>新しいパスコード（もう一度）<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={n2} onChange={(e) => setN2(e.target.value.replace(/\D/g, ""))} /></label>
        <p className="hint">誕生日や、「111111」「123456」のような、かんたんな数字は使えません。他のサービスのパスコードとは、変えてください。</p>
        {msg && <p className="err">{msg}</p>}{ok && <p className="sub" style={{ color: "var(--ok)" }}>✅ {ok}</p>}
        <button onClick={change} disabled={busy || cur.length !== 6 || n1.length !== 6 || n2.length !== 6}>パスコードを変える</button>
      </div>

      {!d?.mustChange && (
        <>
          <div className="card">
            <b>自分のログインの記録（新しい順）</b>
            <p className="sub" style={{ margin: "4px 0 8px" }}>おぼえのない時間・端末があるときは、すぐにパスコードを変えて、オフィスに知らせてください。</p>
            <ul className="list" style={{ margin: 0 }}>{(d?.mine ?? []).map((e, i) => <li key={i}><span>{when(e.at)}</span><span className="sub">{device(e.ua)}</span></li>)}{(d?.mine ?? []).length === 0 && <p className="hint">まだありません。</p>}</ul>
            <div className="toolbar" style={{ marginTop: 10 }}><button className="ghost" onClick={others}>ほかの端末を、すべてログアウトする</button></div>
          </div>

          {me.level === 4 && d?.admin && (
            <>
              <h2>管理者向け：不正アクセスの見はり</h2>
              <div className="card">
                <b>この24時間に、ログインに失敗した社員番号</b>
                {d.admin.failedByCode.length === 0 ? <p className="hint">ありません。</p> : <ul className="list" style={{ margin: "8px 0 0" }}>{d.admin.failedByCode.map((f) => <li key={f.code}><b>社員番号 {f.code}</b><span className="chip warn">{f.n}回 失敗</span></li>)}</ul>}
                <p className="hint">5回続けて失敗すると、15分ロックされます。あやしいときは、その人のパスコードを再発行してください。</p>
              </div>
              <div className="card">
                <b>会社ぜんぶのログインの記録（新しい順・90日分）</b>
                <div className="scroll"><table className="sttable"><thead><tr><th>日時</th><th>社員番号</th><th>名前</th><th>結果</th><th>端末</th></tr></thead>
                  <tbody>{d.admin.recent.map((e, i) => <tr key={i} className={e.ok ? "" : "empty"}><td>{when(e.at)}</td><td>{e.code}</td><td>{e.name ?? "－"}</td><td>{e.ok ? "✅ 成功" : e.reason === "locked" ? "🔒 ロック中" : e.reason === "throttled" ? "⛔ 試しすぎ" : "⚠ 失敗"}</td><td>{device(e.ua)}</td></tr>)}</tbody></table></div>
              </div>
              <div className="card">
                <b>大切な操作の記録（スタッフの登録・レベルや在籍の変更）</b>
                <div className="scroll"><table className="sttable"><thead><tr><th>日時</th><th>操作</th><th>した人</th><th>対象の人</th></tr></thead>
                  <tbody>{d.admin.audit.map((a, i) => <tr key={i}><td>{when(a.at)}</td><td>{ACTION[a.action] ?? a.action}</td><td>{a.actor ?? "－"}</td><td>{a.target ?? "－"}</td></tr>)}</tbody></table></div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
export default function SecurityPage() { return <MeProvider><Page /></MeProvider>; }
