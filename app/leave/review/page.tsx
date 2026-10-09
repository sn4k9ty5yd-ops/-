"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { md } from "@/lib/labels";
import { LEAVE_STATUS_LABEL, type LeaveChange, type LeaveOverviewStore, type LeaveWindow } from "@/lib/service";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
const todayStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const plusMonths = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const what = (c: LeaveChange) => (c.fromDay && c.toDay ? `${md(c.fromDay)} → ${md(c.toDay)} に変更` : c.fromDay ? `${md(c.fromDay)} をやめる` : `${md(c.toDay as string)} を追加`);

function Page() {
  const { me } = useMe();
  const [tab, setTab] = useState<"todo" | "status" | "window">("todo");
  const [review, setReview] = useState<{ todo: LeaveChange[]; recent: LeaveChange[] } | null>(null);
  const [wins, setWins] = useState<LeaveWindow[]>([]);
  const [wid, setWid] = useState("");
  const [ov, setOv] = useState<LeaveOverviewStore[]>([]);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const [nw, setNw] = useState({ label: "", start: todayStr(), end: plusMonths(todayStr(), 6) });

  const load = useCallback(async () => {
    try {
      setReview(await api("/api/paid-leave?review=1"));
      const w = await api<LeaveWindow[]>("/api/paid-leave?windows=1"); const ww = w.filter((x) => !x.standing); setWins(ww); setWid((c) => c || ww[0]?.id || "");
      setMsg("");
    } catch (e) { setMsg((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  useEffect(() => { if (tab === "status" && wid) api<LeaveOverviewStore[]>(`/api/paid-leave?overview=${wid}`).then(setOv).catch((e) => setMsg((e as Error).message)); }, [tab, wid]);

  const decide = async (c: LeaveChange, approve: boolean) => {
    try { await api("/api/paid-leave", { action: "decide", id: c.id, approve, comment: comment[c.id] ?? "" }); setOk(approve ? "OKしました" : "却下しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const openWin = async () => {
    try { await api("/api/paid-leave", { action: "open-window", ...nw }); setOk("受付を始めました。全員にお知らせを送りました"); setNw({ ...nw, label: "" }); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const setStatus = async (w: LeaveWindow, status: "open" | "closed") => { try { await api("/api/paid-leave", { action: "window-status", id: w.id, status }); await load(); } catch (e) { setMsg((e as Error).message); } };
  const tsv = () => ov.flatMap((s) => [s.storeName, "名前\t提出\t日数\t日にち", ...s.people.map((p) => [p.name, p.submitted ? "提出済み" : "未提出", p.days.length, p.days.map(md).join("、")].join("\t")), ""]).join("\n");

  if (me.level < 3) return <main className="wide"><Link href="/leave" className="back">← 有給の申請</Link><h1>有給の確認</h1><p className="hint">この画面は、店長と事務員さんが使います。</p></main>;
  const todoN = review?.todo.length ?? 0;

  return (
    <main className="wide">
      <Link href="/leave" className="back">← 有給の申請</Link>
      <h1>有給の確認・許可</h1>
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub" style={{ color: "var(--ok)" }}>✅ {ok}</p>}
      <div className="seg" style={{ maxWidth: 480 }}>
        <button className={tab === "todo" ? "on" : ""} onClick={() => setTab("todo")}>確認待ち{todoN ? `（${todoN}）` : ""}</button>
        <button className={tab === "status" ? "on" : ""} onClick={() => setTab("status")}>提出状況</button>
        {me.level === 4 && <button className={tab === "window" ? "on" : ""} onClick={() => setTab("window")}>受付の管理</button>}
      </div>

      {tab === "todo" && review && (
        <>
          {review.todo.length === 0 && <p className="hint">いま、確認が必要な申請はありません。</p>}
          {review.todo.map((c) => (
            <div key={c.id} className="card">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}><b style={{ fontSize: 18 }}>{c.name}</b><span className="sub">{c.storeName}・{c.label}</span><span className="chip warn">{LEAVE_STATUS_LABEL[c.status]}</span></div>
              <p style={{ margin: "8px 0" }}><b>{what(c)}</b></p>
              {c.reason && <p className="sub">理由：{c.reason}</p>}
              {c.managerName && <p className="sub">店長 {c.managerName} が確認済み{c.managerComment ? `：「${c.managerComment}」` : ""}</p>}
              <input placeholder="コメント（なくてもOK）" value={comment[c.id] ?? ""} onChange={(e) => setComment({ ...comment, [c.id]: e.target.value })} />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button onClick={() => decide(c, true)}>{c.status === "pending_manager" ? "確認した（事務員さんへ）" : "許可する"}</button>
                <button className="ghost" style={{ color: "var(--bad)" }} onClick={() => decide(c, false)}>却下する</button>
              </div>
            </div>
          ))}
          <h2>最近の結果</h2>
          <ul className="list">{(review?.recent ?? []).map((c) => (
            <li key={c.id}><div><b>{c.name}</b>　{what(c)} <span className="chip">{LEAVE_STATUS_LABEL[c.status]}</span><div className="sub">{c.storeName}・{c.label}</div></div></li>))}
            {(review?.recent ?? []).length === 0 && <p className="hint">まだありません。</p>}</ul>
        </>
      )}

      {tab === "status" && (
        <>
          <div className="toolbar">
            <select aria-label="提出の回" value={wid} onChange={(e) => setWid(e.target.value)}>{wins.map((w) => <option key={w.id} value={w.id}>{w.label}（{w.status === "open" ? "受付中" : "締切"}）</option>)}</select>
            <button className="ghost" onClick={async () => setOk((await copyText(tsv())) ? "表をコピーしました（Excelやメールに貼れます）" : "コピーできませんでした")}>表をコピー</button>
            <button className="ghost" onClick={() => window.print()}>印刷</button>
          </div>
          {wins.length === 0 && <p className="hint">まだ、受付がありません。</p>}
          {ov.map((s) => (
            <div key={s.storeId}>
              <h2>{s.storeName}　<span className="sub">提出 {s.people.filter((p) => p.submitted).length} / {s.people.length}人</span></h2>
              <div className="scroll card"><table className="sttable"><thead><tr><th>名前</th><th>提出</th><th className="r">日数</th><th>日にち</th></tr></thead>
                <tbody>{s.people.map((p) => <tr key={p.id} className={p.submitted ? "" : "empty"}><td>{p.name}</td><td>{p.submitted ? "✅ 提出済み" : "⚠ 未提出"}</td><td className="r">{p.days.length}</td><td>{p.days.map(md).join("、")}</td></tr>)}</tbody></table></div>
            </div>
          ))}
        </>
      )}

      {tab === "window" && me.level === 4 && (
        <>
          <div className="card">
            <b>まとめて提出の受付を始める（期間を決めるとき）</b>
            <p className="sub">始めると、全員にお知らせと通知が届きます。締め切ると、スタッフは日を直接直せなくなり、変更は申請になります。</p>
            <label>名前<input value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} placeholder="例: 2026年 下期" /></label>
            <div className="times"><label>有給を取れる範囲（はじめ）<input type="date" value={nw.start} onChange={(e) => setNw({ ...nw, start: e.target.value })} /></label>
              <label>（おわり）<input type="date" value={nw.end} onChange={(e) => setNw({ ...nw, end: e.target.value })} /></label></div>
            <button onClick={openWin} disabled={!nw.label.trim()}>受付を始める</button>
          </div>
          <ul className="list">{wins.map((w) => (
            <li key={w.id}><div><b>{w.label}</b> <span className="chip">{w.status === "open" ? "受付中" : "締切"}</span><div className="sub">{md(w.rangeStart)}〜{md(w.rangeEnd)}</div></div>
              <button className="ghost" onClick={() => setStatus(w, w.status === "open" ? "closed" : "open")}>{w.status === "open" ? "締め切る" : "もう一度開く"}</button></li>))}</ul>
        </>
      )}
    </main>
  );
}
export default function ReviewPage() { return <MeProvider><Page /></MeProvider>; }
