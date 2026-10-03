"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCallback } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { daysOf, dow, KIND_LABEL, md, shortNames, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import type { PeriodRow, RequestRow } from "@/lib/service";

export default function RequestsOverview() {
  const { me } = useMe();
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [view, setView] = useState<Period>(() => periodFor(todayJst(), me.closingStartDay));
  const [names, setNames] = useState<{ id: string; name: string; storeId: string; shortName?: string | null }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; status: string }[]>([]);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [mode, setMode] = useState<"cal" | "table">("cal");
  useEffect(() => {
    Promise.all([api<PeriodRow[]>("/api/periods"), api<typeof names>("/api/names"), api<typeof stores>("/api/stores")]).then(([p, n, s]) => {
      setPeriods(p); setNames(n); setStores(s);
      // 受付中の期間があればそこから表示
      const open = p.find((x) => x.stores.some((y) => y.status === "collecting"));
      if (open) setView({ start: open.start, end: open.end, label: open.label });
    });
  }, []);
  const db = periods.find((p) => p.start === view.start);
  const loadReqs = useCallback(() => { if (db) api<RequestRow[]>(`/api/requests?periodId=${db.id}`).then(setReqs).catch(() => {}); else setReqs([]); }, [db]);
  useEffect(() => { loadReqs(); }, [loadReqs]);
  useAutoRefresh(loadReqs);
  const days = daysOf(view.start, view.end);
  const key = new Map(reqs.map((r) => [`${r.membershipId}|${r.day}`, r.kind]));
  const activeStores = stores.filter((x) => x.status === "active" && names.some((n) => n.storeId === x.id));
  const sid = activeStores.some((x) => x.id === storeId) ? storeId : (activeStores.find((x) => x.id === me.storeId) ?? activeStores[0])?.id ?? "";
  const people = names.filter((n) => n.storeId === sid);
  const short = shortNames(people);
  const today = todayJst();
  return (
    <>
      <h1>みんなの希望休</h1>
      {!me.displayOnly && <p style={{ margin: "0 0 12px" }}><Link href="/requests" style={{ fontWeight: 700 }}>▶ 自分の希望休を、カレンダーで出す</Link></p>}
      {activeStores.length > 1 && (
        <select aria-label="お店" value={sid} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 12 }}>
          {activeStores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <div className="seg"><button className={mode === "cal" ? "on" : ""} onClick={() => setMode("cal")}>カレンダー</button><button className={mode === "table" ? "on" : ""} onClick={() => setMode("table")}>人ごとの表</button></div>
      {!db && <p className="hint">この期間は、まだ作成されていません。</p>}
      <div className="tintbox" style={tintStyle(view.start)}>
        {mode === "cal" ? (
          <div className="mcal">
            {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
            {Array.from({ length: dow(days[0]) }).map((_, i) => <div key={`b${i}`} />)}
            {days.map((d) => {
              const off = people.filter((n) => key.has(`${n.id}|${d}`));
              return (
                <div key={d} className={`mday req ${d === today ? "today" : ""} ${holidayName(d) ? "hol" : ""} ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}`}>
                  <div className="num">{md(d)}{holidayName(d) && <small className="holname"> {holidayName(d)}</small>}{off.length > 0 && <b className="cnt">{off.length}</b>}</div>
                  {off.length > 0 && <div className="names">{off.map((n, i) => <span key={n.id} className={n.id === me.id ? "me" : ""}>{i > 0 && "・"}{short.get(n.id)}{key.get(`${n.id}|${d}`) === "paid" ? "(有)" : ""}</span>)}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead><tr><th>名前</th>{days.map((d) => <th key={d} title={holidayName(d) ?? undefined} className={dow(d) === 0 || holidayName(d) ? "su" : dow(d) === 6 ? "sa" : ""}>{md(d)}</th>)}<th>計</th></tr></thead>
              <tbody>
                {people.map((n) => {
                  const cnt = days.filter((d) => key.has(`${n.id}|${d}`)).length;
                  return (
                    <tr key={n.id}><td className="name">{n.name}</td>
                      {days.map((d) => { const k = key.get(`${n.id}|${d}`); return <td key={d} className={k ? "mark" : ""} title={k ? KIND_LABEL[k] : ""}>{k ? (k === "paid" ? "有" : "●") : ""}</td>; })}
                      <td><b>{cnt}</b></td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="hint">カレンダーの日付の横の数字は、その日に休みの希望が出ている人数です。（有）は有給です。自分が見られるお店の分だけ表示されます。</p>
    </>
  );
}
