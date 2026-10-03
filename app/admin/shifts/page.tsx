"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { daysOf, dow, md, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { cellText, hoursText, KIND_BUTTONS, kindClass, longText } from "@/lib/shift-ui";
import { STATUS_LABEL, type PeriodRow, type RequestRow, type ShiftEntry, type ShiftKind, type ShiftRow, type StoreRow } from "@/lib/service";
import { ShiftSheet } from "./ShiftSheet";

type Person = { id: string; name: string; level: number };
type Mode = "day" | "person" | "table";
type Target = { person: Person; days: string[] };

export default function ShiftsPage() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [view, setView] = useState<Period>(() => periodFor(todayJst(), me.closingStartDay));
  const [mode, setMode] = useState<Mode>("day");
  const [roster, setRoster] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [editable, setEditable] = useState(false);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [day, setDay] = useState("");
  const [personId, setPersonId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bar, setBar] = useState<{ kind: ShiftKind; start: string; end: string }>({ kind: "work", start: "10:00", end: "19:00" });
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [loadedKey, setLoadedKey] = useState("");

  const store = stores.find((s) => s.id === storeId);
  const defaults = useMemo(() => ({ start: store?.defaultOpen ?? "10:00", end: store?.defaultClose ?? "19:00" }), [store]);
  const dbPeriod = periods.find((p) => p.start === view.start);
  const pstatus = dbPeriod?.stores.find((s) => s.storeId === storeId)?.status;
  const days = daysOf(view.start, view.end);

  // 最初に1回: お店と期間の一覧。作成中の期間があればそこを開く
  useEffect(() => {
    Promise.all([api<StoreRow[]>("/api/stores"), api<PeriodRow[]>("/api/periods")]).then(([s, p]) => {
      setStores(s.filter((x) => x.status === "active")); setPeriods(p);
      // 作業中の期間を優先して開く（作成中 → 受付中 → 確定・公開済み の順）
      const d = ["drafting", "closed", "collecting", "confirmed", "published"].map((st) => p.find((x) => x.stores.some((y) => y.storeId === me.storeId && y.status === st))).find(Boolean);
      if (d) setView({ start: d.start, end: d.end, label: d.label });
    });
  }, [me.storeId]);

  const load = useCallback(async () => {
    const p = await api<PeriodRow[]>("/api/periods"); setPeriods(p);
    const db = p.find((x) => x.start === view.start);
    setRoster(await api<Person[]>(`/api/roster?storeId=${storeId}`));
    if (!db) { setShifts([]); setReqs([]); setEditable(false); setLoadedKey(`${storeId}|${view.start}`); return; }
    const [s, r] = await Promise.all([api<{ shifts: ShiftRow[]; editable: boolean }>(`/api/shifts?periodId=${db.id}&storeId=${storeId}`), api<RequestRow[]>(`/api/requests?periodId=${db.id}`)]);
    setShifts(s.shifts); setEditable(s.editable); setReqs(r); setLoadedKey(`${storeId}|${view.start}`);
  }, [storeId, view.start]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { if (!target) load().catch(() => {}); });

  useEffect(() => { if (!days.includes(day)) { const t = todayJst(); setDay(days.includes(t) ? t : days[0]); } }, [view.start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!roster.find((r) => r.id === personId)) setPersonId(roster[0]?.id ?? ""); }, [roster, personId]);
  useEffect(() => { setBar((b) => ({ ...b, start: defaults.start, end: defaults.end })); }, [defaults.start, defaults.end]);
  useEffect(() => { if (typeof window !== "undefined" && window.innerWidth >= 900) setMode("table"); }, []);

  const byKey = useMemo(() => new Map(shifts.map((s) => [`${s.membershipId}|${s.day}`, s])), [shifts]);
  const reqKey = useMemo(() => new Map(reqs.map((r) => [`${r.membershipId}|${r.day}`, r.kind])), [reqs]);
  const periodId = dbPeriod?.id;

  const post = async (body: object) => {
    try { setMsg(""); const r = await api<{ count: number }>("/api/shifts", { periodId, storeId, ...body }); await load(); return r.count; }
    catch (e) { setMsg((e as Error).message); throw e; }
  };
  const save = async (entries: ShiftEntry[]) => { await post({ action: "save", entries }); };
  const loading = loadedKey !== `${storeId}|${view.start}`;
  const readOnlyReason = loading ? "" : !dbPeriod ? "この期間は、まだ作成されていません。" : editable ? "" : storeId !== me.storeId && me.level < 4 ? "他のお店のシフトです（見るだけ）。" : pstatus === "preparing" ? "まだ準備中です。希望休の受付を始めるか、シフト作成を始めると入力できます。" : "いまはシフトを変更できません（確定済みなど）。";

  const dayCount = (d: string) => roster.filter((r) => byKey.get(`${r.id}|${d}`)?.kind === "work").length;

  return (
    <>
      <h1>シフト作成</h1>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="seg" style={{ margin: 0 }}>
          {([["day", "日ごと"], ["person", "人ごと"], ["table", "一覧表"]] as [Mode, string][]).map(([m, l]) => <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{l}</button>)}
        </div>
      </div>
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <p className="sub" style={{ margin: "0 0 8px" }}>{store?.name}：{loading ? "読み込み中…" : pstatus ? STATUS_LABEL[pstatus] : "未作成"}　{readOnlyReason && <b style={{ color: "#b45309" }}>{readOnlyReason}</b>}</p>
      {editable && !loading && (
        <div className="actions" style={{ marginBottom: 8 }}>
          <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => { const n = await post({ action: "applyRequests" }); setNote(`希望休を${n}件、シフトに反映しました`); }}>希望休をシフトに反映</button>
          {note && <span className="sub">{note}</span>}
        </div>
      )}
      {msg && <p className="err">{msg}</p>}

      <div className="tintbox" style={tintStyle(view.start)}>
        {/* ------------------------------------------------ 日ごと */}
        {mode === "day" && (
          <>
            <div className="daystrip">
              {days.map((d) => (
                <button key={d} className={`${d === day ? "on" : ""} ${dow(d) === 0 ? "su" : dow(d) === 6 ? "sa" : ""}`} onClick={() => setDay(d)}>
                  <small>{WEEKDAYS[dow(d)]}</small><b>{md(d)}</b><small>{dayCount(d)}人</small>
                </button>
              ))}
            </div>
            <div className="card" style={{ marginTop: 10 }}>
              <b style={{ fontSize: 18 }}>{md(day || days[0])}（{WEEKDAYS[dow(day || days[0])]}）</b>
              {editable && (
                <button style={{ marginTop: 10, padding: 12, fontSize: 15 }} onClick={async () => { const n = await post({ action: "fill", days: [day], start: defaults.start, end: defaults.end }); setNote(`${n}人分を入れました`); }}>
                  全員を {defaults.start}〜{defaults.end} で入れる
                </button>
              )}
              <ul className="list" style={{ margin: "10px 0 0" }}>
                {roster.map((p) => {
                  const s = byKey.get(`${p.id}|${day}`), r = reqKey.get(`${p.id}|${day}`);
                  return (
                    <li key={p.id} className="rowbtn" onClick={() => editable && setTarget({ person: p, days: [day] })} style={{ cursor: editable ? "pointer" : "default" }}>
                      <div><b>{p.name}</b>{r && <span className="chip warn">{r === "paid" ? "有給希望" : "希望休"}</span>}</div>
                      <span className={`pill ${kindClass(s)}`}>{longText(s)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        {/* ------------------------------------------------ 人ごと */}
        {mode === "person" && (
          <>
            <select aria-label="スタッフ" value={personId} onChange={(e) => { setPersonId(e.target.value); setPicked(new Set()); }}>
              {roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="sub" style={{ margin: "8px 4px" }}>{editable ? "日をタップして選び、下の「選んだ日に入れる」を押します。" : ""}</p>
            <div className="cal2">
              {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
              {Array.from({ length: dow(days[0]) }).map((_, i) => <div key={`b${i}`} />)}
              {days.map((d) => {
                const s = byKey.get(`${personId}|${d}`), r = reqKey.get(`${personId}|${d}`);
                return (
                  <button key={d} className={`d cellp ${kindClass(s)} ${picked.has(d) ? "pick" : ""}`} disabled={!editable}
                    onClick={() => setPicked((p) => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; })}>
                    <span>{md(d)}</span><small>{cellText(s)}</small>{r && <i className="dot" title="希望休" />}
                  </button>
                );
              })}
            </div>
            {editable && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="seg">{KIND_BUTTONS.map((k) => <button key={k.kind} className={bar.kind === k.kind ? "on" : ""} onClick={() => setBar({ ...bar, kind: k.kind })}>{k.label}</button>)}</div>
                {bar.kind === "work" && (
                  <>
                    <div className="times"><label>入店<input type="time" value={bar.start} onChange={(e) => setBar({ ...bar, start: e.target.value })} /></label>
                      <label>退店<input type="time" value={bar.end} onChange={(e) => setBar({ ...bar, end: e.target.value })} /></label></div>
                    <div className="sub" style={{ margin: "6px 0" }}>{hoursText(bar.start, bar.end, me.breakRule)}</div>
                  </>
                )}
                <div className="actions" style={{ marginTop: 8 }}>
                  <button style={{ width: "auto", margin: 0, flex: 1 }} disabled={picked.size === 0}
                    onClick={async () => { await save([...picked].map((d) => ({ membershipId: personId, day: d, kind: bar.kind, start: bar.start, end: bar.end }))); setPicked(new Set()); }}>
                    選んだ日（{picked.size}日）に入れる
                  </button>
                  <button className="ghost" disabled={picked.size === 0} onClick={async () => { await post({ action: "clear", items: [...picked].map((d) => ({ membershipId: personId, day: d })) }); setPicked(new Set()); }}>消す</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ------------------------------------------------ 一覧表 */}
        {mode === "table" && (
          <div className="scroll">
            <table className="shifttable">
              <thead><tr><th>名前</th>{days.map((d) => <th key={d} className={dow(d) === 0 ? "su" : dow(d) === 6 ? "sa" : ""}>{md(d)}<br /><small>{WEEKDAYS[dow(d)]}</small></th>)}</tr></thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id}><td className="name">{p.name}</td>
                    {days.map((d) => {
                      const s = byKey.get(`${p.id}|${d}`), r = reqKey.get(`${p.id}|${d}`);
                      return <td key={d} className={`${kindClass(s)} ${editable ? "click" : ""}`} onClick={() => editable && setTarget({ person: p, days: [d] })}>{cellText(s)}{r && !s && <i className="dot" />}</td>;
                    })}
                  </tr>
                ))}
                <tr className="sumrow"><td className="name">出勤人数</td>{days.map((d) => <td key={d}>{dayCount(d)}</td>)}</tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="hint">● 小さい点＝希望休が出ています。色: 出勤＝白、休み＝ピンク、有給＝黄色、公休＝水色。</p>

      {target && (
        <ShiftSheet
          title={`${target.person.name}　${md(target.days[0])}（${WEEKDAYS[dow(target.days[0])]}）`}
          sub={reqKey.get(`${target.person.id}|${target.days[0]}`) ? "この日は希望休が出ています" : undefined}
          initial={byKey.get(`${target.person.id}|${target.days[0]}`)} defaults={defaults}
          onSave={(e) => save([{ membershipId: target.person.id, day: target.days[0], ...e }])}
          onClear={async () => { await post({ action: "clear", items: [{ membershipId: target.person.id, day: target.days[0] }] }); }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
