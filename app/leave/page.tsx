"use client";
import { SubTabs } from "@/app/SubTabs";
import { shiftTabs } from "@/lib/shift-tabs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { dow, md, WEEKDAYS } from "@/lib/labels";
import { LEAVE_STATUS_LABEL, type LeaveChange, type LeaveWindow } from "@/lib/service";

const monthsOf = (a: string, b: string) => { const out: string[] = []; let [y, m] = [Number(a.slice(0, 4)), Number(a.slice(5, 7))]; const [ey, em] = [Number(b.slice(0, 4)), Number(b.slice(5, 7))]; while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; };
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const statusColor: Record<string, string> = { pending_manager: "var(--warn)", pending_office: "var(--warn)", approved: "var(--ok)", rejected: "var(--bad)", cancelled: "var(--sub)" };

function MonthPick({ ym, range, chosen, onToggle }: { ym: string; range: [string, string]; chosen: Set<string>; onToggle?: (d: string) => void }) {
  const lead = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
  return (
    <div style={{ marginBottom: 14 }}>
      <b>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
      <div className="mcal" style={{ marginTop: 6 }}>
        {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysIn(ym) }, (_, i) => {
          const d = `${ym}-${String(i + 1).padStart(2, "0")}`; const inR = d >= range[0] && d <= range[1]; const on = chosen.has(d);
          return (
            <button key={d} type="button" disabled={!inR || !onToggle} onClick={() => onToggle?.(d)}
              className={`leaveday ${on ? "on" : ""} ${holidayName(d) ? "hol" : ""} ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}`} aria-pressed={on}>
              <span>{i + 1}</span>{holidayName(d) && <small className="holname">{holidayName(d)}</small>}{on && <small className="lv">有給</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Page() {
  const { me } = useMe();
  const [wins, setWins] = useState<LeaveWindow[]>([]);
  const [wid, setWid] = useState("");
  const [data, setData] = useState<{ days: string[]; submitted: boolean; changes: LeaveChange[] } | null>(null);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const [req, setReq] = useState<{ from: string | null; to: string; reason: string } | null>(null);

  const win = wins.find((w) => w.id === wid);
  const loadWins = useCallback(async () => { const w = await api<LeaveWindow[]>("/api/paid-leave?windows=1"); setWins(w); setWid((cur) => cur || w.find((x) => x.status === "open" && !x.standing)?.id || w.find((x) => x.standing)?.id || w[0]?.id || ""); }, []);
  useEffect(() => { loadWins().catch((e) => setMsg((e as Error).message)); }, [loadWins]);
  const load = useCallback(async () => { if (!wid) return; try { const d = await api<{ days: string[]; submitted: boolean; changes: LeaveChange[] }>(`/api/paid-leave?window=${wid}`); setData(d); setMsg(""); } catch (e) { setMsg((e as Error).message); } }, [wid]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => { if (!draft && !req) { load(); loadWins().catch(() => {}); } });

  const open = win?.status === "open";
  const chosen = draft ?? new Set(data?.days ?? []);
  const toggle = (d: string) => setDraft((cur) => { const n = new Set(cur ?? data?.days ?? []); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const save = async (submit: boolean) => {
    try {
      await api("/api/paid-leave", { action: "set-days", windowId: wid, days: [...chosen].sort() });
      if (submit) await api("/api/paid-leave", { action: "submit", windowId: wid, on: true });
      setDraft(null); setOk(submit ? "提出しました" : "保存しました（まだ提出していません）"); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const sendReq = async () => {
    if (!req || !win) return;
    try { await api("/api/paid-leave", { action: "request", windowId: wid, from: req.from, to: req.to || null, reason: req.reason }); setReq(null); setOk("申請しました。店長の確認 → 正美さんの許可の順に進みます"); await load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const cancel = async (c: LeaveChange) => { try { await api("/api/paid-leave", { action: "cancel", id: c.id }); await load(); } catch (e) { setMsg((e as Error).message); } };
  const months = useMemo(() => (win ? monthsOf(win.rangeStart, win.rangeEnd) : []), [win]);

  if (me.displayOnly) return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>有給の申請</h1><p className="hint">このアカウントは、見るだけです。</p></main>;
  const dayList = (data?.days ?? []).filter((d) => !win?.standing || d >= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)).sort();
  const pendingKeys = new Set((data?.changes ?? []).filter((c) => c.status.startsWith("pending")).map((c) => c.fromDay));

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>シフト</h1>
      <SubTabs items={shiftTabs(me.level)} />
      <SubTabs items={[{ href: "/requests", label: "希望休" }, { href: "/leave", label: "有給申請" }]} />
      <p className="hint">ここは「出す」画面です。有給を取りたいときは、いつでも申請できます（店長が確認 → 正美さんが許可）。</p>
      {(me.level >= 3) && <Link href="/leave/review" className="storelink" style={{ display: "inline-block", marginBottom: 12 }}>{me.level === 4 ? "確認・許可・提出状況・受付の管理へ" : "確認・提出状況へ"}</Link>}
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub" style={{ color: "var(--ok)" }}>✅ {ok}</p>}
      {wins.length > 1 && (
        <div className="toolbar"><select aria-label="提出の回" value={wid} onChange={(e) => { setWid(e.target.value); setDraft(null); }}>{wins.map((w) => <option key={w.id} value={w.id}>{w.standing ? w.label : `${w.label}（${w.status === "open" ? "受付中" : "締切"}）`}</option>)}</select></div>
      )}

      {win && open && (
        <>
          <div className="card">
            <b>{win.label}：有給を取りたい日を選んでください</b>
            <p className="sub">{md(win.rangeStart)}〜{md(win.rangeEnd)} の間で、日にちを押すと選べます（もう一度押すと、はずれます）。選んだら「提出する」を押します。</p>
            <p>選んだ日：<b>{chosen.size}日</b>　{data?.submitted && !draft ? <span className="chip" style={{ background: "color-mix(in srgb,var(--ok) 20%,var(--card))" }}>提出済み</span> : <span className="chip warn">まだ提出していません</span>}</p>
          </div>
          {months.map((m) => <MonthPick key={m} ym={m} range={[win.rangeStart, win.rangeEnd]} chosen={chosen} onToggle={toggle} />)}
          <div className="stickybar">
            <button onClick={() => save(true)}>提出する（{chosen.size}日）</button>
            {draft && <button className="ghost" onClick={() => save(false)}>保存だけ</button>}
            {draft && <button className="ghost" onClick={() => setDraft(null)}>やめる</button>}
          </div>
        </>
      )}

      {win && !open && (
        <>
          <div className="card">
            <b>{win.standing ? "あなたの有給の日（許可されたもの）" : `${win.label}：あなたの有給の日`}（{dayList.length}日）</b>
            <p className="sub">{win.standing ? "取りたい日は、いつでも「＋ 有給を申請する」から申請できます。" : "提出は締め切られました。日を変えたいときは、「変更を申請」を押します。"}<b>店長が確認 → 正美さんが許可</b>すると、決まります。</p>
            {dayList.length === 0 && <p className="hint">{win.standing ? "まだ、許可された有給の日はありません。" : "この回では、有給の日を出していません。「追加を申請」から申請できます。"}</p>}
            {dayList.map((d) => (
              <div key={d} className="toolbar" style={{ justifyContent: "space-between", margin: "6px 0" }}>
                <span><b>{md(d)}（{WEEKDAYS[dow(d)]}）</b>{pendingKeys.has(d) && <span className="chip warn">申請中</span>}</span>
                <button className="ghost" disabled={pendingKeys.has(d)} onClick={() => { setMsg(""); setReq({ from: d, to: "", reason: "" }); }}>変更を申請</button>
              </div>
            ))}
            <button className="ghost" onClick={() => { setMsg(""); setReq({ from: null, to: "", reason: "" }); }}>{win.standing ? "＋ 有給を申請する" : "＋ 追加を申請"}</button>
          </div>
          <h2>これまでの申請</h2>
          {(data?.changes ?? []).length === 0 && <p className="hint">まだ申請はありません。</p>}
          <ul className="list">{(data?.changes ?? []).map((c) => (
            <li key={c.id}>
              <div>
                <b>{c.fromDay && c.toDay ? `${md(c.fromDay)} → ${md(c.toDay)} に変更` : c.fromDay ? `${md(c.fromDay)} をやめる` : `${md(c.toDay as string)} を追加`}</b>
                <span className="chip" style={{ color: statusColor[c.status] }}>{LEAVE_STATUS_LABEL[c.status]}</span>
                <div className="sub">{[c.reason && `理由：${c.reason}`, c.managerName && `店長 ${c.managerName}${c.managerComment ? `「${c.managerComment}」` : ""}`, c.officeName && `正美さん ${c.officeName}${c.officeComment ? `「${c.officeComment}」` : ""}`].filter(Boolean).join("　")}</div>
              </div>
              {c.status.startsWith("pending") && <button className="ghost" onClick={() => cancel(c)}>取り消す</button>}
            </li>))}</ul>
        </>
      )}

      {req && win && (
        <div className="sheet-bg" onClick={() => setReq(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="有給の変更を申請">
            <h3>{req.from ? `${md(req.from)} の有給を変更` : "有給の日を追加"}</h3>
            <label>{req.from ? "変えたい先の日（やめるだけなら、空のまま）" : "追加したい日"}
              <input type="date" min={win.standing ? undefined : win.rangeStart} max={win.standing ? undefined : win.rangeEnd} value={req.to} onChange={(e) => setReq({ ...req, to: e.target.value })} /></label>
            <label>理由（なくてもOK）<input value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })} placeholder="例: 家族の予定のため" /></label>
            <p className="sub">申請は、まず店長が確認し、そのあと正美さんが許可します。結果は、通知とお知らせで届きます。</p>
            {msg && <p className="err">{msg}</p>}
            <div className="toolbar"><button onClick={sendReq} disabled={!req.from && !req.to}>申請する</button><button className="ghost" onClick={() => setReq(null)}>やめる</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
export default function LeavePage() { return <MeProvider><Page /></MeProvider>; }
