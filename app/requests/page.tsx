"use client";
import { SubTabs } from "@/app/SubTabs";
import { shiftTabs } from "@/lib/shift-tabs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { daysOf, dow, KIND_LABEL, md, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { STATUS_LABEL, type PeriodRow, type RequestRow } from "@/lib/service";

function Page() {
  const { me } = useMe();
  const [all, setAll] = useState<PeriodRow[] | null>(null);
  const [view, setView] = useState<Period | null>(null);
  const [mine, setMine] = useState<Map<string, string>>(new Map());
  const [msg, setMsg] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PeriodRow[]>("/api/periods").then((ps) => {
      setAll(ps);
      // まず「いま受付中の期間」、なければ「今回の期間」を表示
      const open = ps.find((p) => p.stores.some((s) => s.storeId === me.storeId && s.status === "collecting"));
      setView(open ? { start: open.start, end: open.end, label: open.label } : periodFor(todayJst(), me.closingStartDay));
    });
  }, [me.storeId, me.closingStartDay]);

  const db = all?.find((p) => p.start === view?.start);
  const load = useCallback(async () => {
    if (!db) { setMine(new Map()); return; }
    const rs = await api<RequestRow[]>(`/api/requests?periodId=${db.id}`);
    setMine(new Map(rs.filter((r) => r.membershipId === me.id).map((r) => [r.day, r.kind])));
  }, [db, me.id]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  if (me.displayOnly) return <main><Link href="/shifts" className="back">← シフト</Link><h1>希望休</h1><p className="hint">このアカウントは、見るだけです。希望休は出せません。</p></main>;
  if (!view || !all) return null;
  const st = db?.stores.find((s) => s.storeId === me.storeId);
  const open = !!db && st?.status === "collecting" && (!st.closeAt || new Date(st.closeAt) > new Date());
  const days = daysOf(view.start, view.end);
  const lead = dow(days[0]);

  return (
    <main>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>シフト</h1>
      <SubTabs items={shiftTabs(me.level)} />
      <SubTabs items={[{ href: "/requests", label: "希望休" }, { href: "/leave", label: "有給申請" }]} />
      <p className="hint">ここは「出す」画面です。休みたい日を、カレンダーで出します。</p>
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <div className="tintbox" style={tintStyle(view.start)}>
        <p className="sub" style={{ margin: "4px 4px 10px" }}>
          {!db ? "この期間は、まだ作成されていません。" : open
            ? `${STATUS_LABEL[st!.status]}。休みたい日をタップして、公休か有給かを選んでください。`
            : `いまは受付していません（${st ? STATUS_LABEL[st.status] : ""}）。`}
        </p>
        <div className="cal2">
          {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
          {days.map((d) => {
            const kind = mine.get(d);
            return (
              <button key={d} disabled={!open && !kind} className={`d ${kind ? "on" : ""} ${holidayName(d) ? "hol" : ""}`}
                onClick={() => { setMsg(""); setPick(d); }}>
                <span>{md(d)}</span>{holidayName(d) && <small className="holname">{holidayName(d)}</small>}{kind && <small>{KIND_LABEL[kind]}</small>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="hint">この期間に出した希望休：{mine.size}日（公休 {[...mine.values()].filter((k) => k !== "paid").length}日・有給 {[...mine.values()].filter((k) => k === "paid").length}日）</p>
      {pick && (
        <div className="sheet-bg" onClick={() => setPick(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="公休か有給か選ぶ">
            <b style={{ fontSize: 18 }}>{md(pick)}（{WEEKDAYS[dow(pick)]}）</b>
            <div className="sub">{mine.has(pick) ? `いまは「${KIND_LABEL[mine.get(pick)!]}」で出しています。` : "この日を、どちらで出しますか？"}</div>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {([["hope", "公休で出す"], ["paid", "有給で出す"]] as const).map(([k, label]) => (
              <button key={k} disabled={busy || !open} className={mine.get(pick) === k ? "" : "ghost"} style={mine.get(pick) === k ? undefined : { color: "var(--ink)", border: "1px solid var(--line)" }}
                onClick={async () => { setBusy(true); try { await api("/api/requests", { periodId: db!.id, day: pick, kind: k }); setMsg(""); await load(); setPick(null); } catch (e) { setMsg((e as Error).message); setPick(null); } finally { setBusy(false); } }}>
                {label}{mine.get(pick) === k ? "（いまの）" : ""}
              </button>
            ))}
            {mine.has(pick) && (
              <button className="ghost" disabled={busy || !open} onClick={async () => { setBusy(true); try { await api("/api/requests", { periodId: db!.id, day: pick, kind: null }); setMsg(""); await load(); setPick(null); } catch (e) { setMsg((e as Error).message); setPick(null); } finally { setBusy(false); } }}>この日の希望を取り消す</button>
            )}
            <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => setPick(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
    </main>
  );
}
export default function RequestsPage() { return <MeProvider><Page /></MeProvider>; }
