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
  const [cnt, setCnt] = useState<Map<string, number>>(new Map());
  const [lim, setLim] = useState<Map<string, number>>(new Map());
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
    if (!db) { setMine(new Map()); setCnt(new Map()); setLim(new Map()); return; }
    const rs = await api<RequestRow[]>(`/api/requests?periodId=${db.id}`);
    setMine(new Map(rs.filter((r) => r.membershipId === me.id).map((r) => [r.day, r.kind])));
    const c = new Map<string, number>();
    for (const r of rs) if (r.storeId === me.storeId) c.set(r.day, (c.get(r.day) ?? 0) + 1);
    setCnt(c);
    const dl = await api<{ limits: { day: string; maxOff: number }[] }>(`/api/day-limits?periodId=${db.id}&storeId=${me.storeId}`).catch(() => null);
    setLim(new Map((dl?.limits ?? []).map((l) => [l.day, l.maxOff])));
  }, [db, me.id, me.storeId]);
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
            const n = cnt.get(d) ?? 0, m = lim.get(d);
            return (
              <button key={d} disabled={!open && !kind} className={`d ${kind ? "on" : ""} ${holidayName(d) ? "hol" : ""}`}
                onClick={() => { setMsg(""); setPick(d); }}>
                <span>{md(d)}</span>{holidayName(d) && <small className="holname">{holidayName(d)}</small>}{kind && <small>{KIND_LABEL[kind]}</small>}
                {(m !== undefined || n > 0) && <small style={{ display: "block", fontSize: 10, color: m !== undefined && n > m ? "#d70015" : "var(--sub)", fontWeight: m !== undefined && n > m ? 800 : 400 }}>{n}人{m !== undefined ? `/${m}` : ""}</small>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="hint">日付の下の数字は「休みを出している人／休める人数の目安」です。目安をこえても、希望休は出せます（あとで店長・シフト担当が調整します）。みんなの休みは、<Link href="/shifts" style={{ color: "var(--blue)" }}>「見る」</Link>のカレンダーで見られます（見るだけ）。</p>
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
