"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { dow, md, daysOf, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { STATUS_ORDER, type PeriodRow, type ShiftRow, type StoreRow } from "@/lib/service";
import { longText } from "@/lib/shift-ui";

type Person = { id: string; name: string };
const LABEL: Record<string, string> = { off: "休", paid: "有給", holiday: "公休", other: "他" };

function Page() {
  const { me, logout } = useMe();
  const today = todayJst();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [view, setView] = useState<Period | null>(null);
  const [roster, setRoster] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [show, setShow] = useState<"work" | "off">("work");
  const [ready, setReady] = useState(false);

  const isPub = (p: PeriodRow, sid: string) => { const st = p.stores.find((s) => s.storeId === sid); return !!st && STATUS_ORDER.indexOf(st.status) >= STATUS_ORDER.indexOf("published"); };

  useEffect(() => {
    Promise.all([api<StoreRow[]>("/api/stores"), api<PeriodRow[]>("/api/periods")]).then(([s, p]) => {
      setStores(s.filter((x) => x.status === "active")); setPeriods(p);
      const pub = p.filter((x) => isPub(x, me.storeId));
      const cur = pub.find((x) => x.start <= today && today <= x.end) ?? pub[0];
      setView(cur ? { start: cur.start, end: cur.end, label: cur.label } : periodFor(today, me.closingStartDay));
      setReady(true);
    });
  }, [me.storeId, me.closingStartDay, today]);

  const db = periods.find((p) => p.start === view?.start);
  const load = useCallback(async () => {
    if (!view) return;
    setRoster(await api<Person[]>(`/api/roster?storeId=${storeId}`));
    if (!db) { setShifts([]); return; }
    setShifts((await api<{ shifts: ShiftRow[] }>(`/api/shifts?periodId=${db.id}&storeId=${storeId}`)).shifts);
  }, [db, storeId, view]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { load().catch(() => {}); });

  const name = useMemo(() => new Map(roster.map((r) => [r.id, r.name])), [roster]);
  const byDay = useMemo(() => { const m = new Map<string, ShiftRow[]>(); for (const s of shifts) m.set(s.day, [...(m.get(s.day) ?? []), s]); return m; }, [shifts]);
  if (!ready || !view) return null;
  const days = daysOf(view.start, view.end);
  const todays = (byDay.get(today) ?? []).filter((s) => s.kind === "work").sort((a, b) => (a.start! < b.start! ? -1 : 1));
  const todayOff = (byDay.get(today) ?? []).filter((s) => s.kind !== "work");
  const published = !!db && isPub(db, storeId);
  const inView = view.start <= today && today <= view.end;

  return (
    <main style={{ maxWidth: 900 }}>
      {!me.displayOnly && <Link href="/home" className="back">← ホーム</Link>}
      <h1>{me.displayOnly ? `${stores.find((x) => x.id === me.storeId)?.name ?? ""} のシフト` : "シフト"}</h1>
      {(me.level >= 3) && (
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 12 }}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {inView && published && (
        <div className="card">
          <b style={{ fontSize: 18 }}>今日（{md(today)}）の出勤</b>
          {todays.length === 0 ? <p className="sub">出勤の人はいません。</p> : (
            <ul className="list" style={{ margin: "8px 0 0" }}>
              {todays.map((s) => <li key={s.id}><b>{name.get(s.membershipId) ?? ""}{s.membershipId === me.id && "（あなた）"}</b><span className="pill k-work">{longText(s)}</span></li>)}
            </ul>
          )}
          {todayOff.length > 0 && <p className="sub" style={{ marginTop: 8 }}>お休み：{todayOff.map((s) => `${name.get(s.membershipId) ?? ""}（${LABEL[s.kind]}）`).join("、")}</p>}
        </div>
      )}
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <div className="seg"><button className={show === "work" ? "on" : ""} onClick={() => setShow("work")}>出勤する人</button><button className={show === "off" ? "on" : ""} onClick={() => setShow("off")}>みんなの休み</button></div>
      {!published && me.level < 2 ? <p className="hint">この期間のシフトは、まだ公開されていません。</p> : (
        <div className="tintbox" style={tintStyle(view.start)}>
          {!published && <p className="sub" style={{ margin: "4px 4px 8px" }}>公開前（作成中）のシフトです。スタッフには見えません。</p>}
          <div className="mcal">
            {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
            {Array.from({ length: dow(days[0]) }).map((_, i) => <div key={`b${i}`} />)}
            {days.map((d) => {
              const list = (byDay.get(d) ?? []).filter((s) => (show === "work" ? s.kind === "work" : s.kind !== "work"));
              const anyPaid = show === "off" && list.some((s) => s.kind === "paid");
              return (
                <div key={d} className={`mday ${d === today ? "today" : ""} ${anyPaid ? "k-paid" : ""} ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}`}>
                  <div className="num">{md(d)}</div>
                  {list.length === 0 && show === "off" ? <small className="sub">なし</small> : list.map((s) => (
                    <div key={s.id} className={`nm ${s.membershipId === me.id ? "me" : ""}`}>{name.get(s.membershipId) ?? ""}{show === "off" ? `(${LABEL[s.kind]})` : ""}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {published && !me.displayOnly && <p className="hint">自分の名前は太字で表示されます。</p>}
      {me.displayOnly && <button className="ghost" style={{ color: "var(--sub)", width: "auto", marginTop: 24 }} onClick={logout}>ログアウト</button>}
    </main>
  );
}
export default function ShiftsView() { return <MeProvider><Page /></MeProvider>; }
