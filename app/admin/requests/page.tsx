"use client";
import { useEffect, useState } from "react";
import { useCallback } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { daysOf, dow, KIND_LABEL, md } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import type { PeriodRow, RequestRow } from "@/lib/service";

export default function RequestsOverview() {
  const { me } = useMe();
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [view, setView] = useState<Period>(() => periodFor(todayJst(), me.closingStartDay));
  const [names, setNames] = useState<{ id: string; name: string; storeId: string }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; status: string }[]>([]);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
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
  return (
    <>
      <h1>みんなの希望休</h1>
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      {!db && <p className="hint">この期間は、まだ作成されていません。</p>}
      <div className="tintbox" style={tintStyle(view.start)}>
        {stores.filter((s) => s.status === "active").map((s) => {
          const people = names.filter((n) => n.storeId === s.id);
          if (!people.length) return null;
          return (
            <div key={s.id} style={{ marginBottom: 16 }}>
              <h2 style={{ margin: "8px 0" }}>{s.name}</h2>
              <div className="scroll">
                <table>
                  <thead><tr><th>名前</th>{days.map((d) => <th key={d} className={dow(d) === 0 ? "su" : dow(d) === 6 ? "sa" : ""}>{md(d)}</th>)}<th>計</th></tr></thead>
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
            </div>
          );
        })}
      </div>
      <p className="hint">● 希望休　有 有給　（自分が見られるお店の分だけ表示されます）</p>
    </>
  );
}
