"use client";
import { SubTabs } from "@/app/SubTabs";
import { PasteOff } from "./PasteOff";
import { LimitAll } from "./LimitAll";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { fmt } from "@/lib/hours";
import { holidayName } from "@/lib/holidays";
import { daysOf, dow, hoursOn, md, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { attendanceLines, shiftHours, cellText, hoursText, sortRoster, KIND_BUTTONS, kindClass, longText } from "@/lib/shift-ui";
import { STATUS_LABEL, type AttendanceRow, type PeriodRow, type RequestRow, type ShiftEntry, type ShiftKind, type ShiftRow, type StoreRow } from "@/lib/service";
import { ShiftSheet } from "./ShiftSheet";

/** 出勤簿確定の1日分を、表の形（ShiftRow）にそろえる */
const asShift = (r: AttendanceRow): ShiftRow => ({ id: r.id, membershipId: r.membershipId, storeId: r.storeId, periodId: r.periodId, day: r.day, kind: r.kind, start: r.clockIn, end: r.clockOut, breakMin: r.kind === "work" ? r.breakMin : null });
type Person = { id: string; name: string; level: number };
type Mode = "day" | "person" | "table";
type Target = { person: Person; days: string[] };

/** 「出勤簿予定」（final=false）と「出勤簿確定」（final=true）は、まったく同じ形の表。確定は実際の勤務を直す表で、はじめはシフト（予定）のとおりに入る */
export function ShiftsView({ final = false }: { final?: boolean }) {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [view, setView] = useState<Period>(() => periodFor(todayJst(), me.closingStartDay));
  const [mode, setMode] = useState<Mode>("table");
  const [roster, setRoster] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [editable, setEditable] = useState(false);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [day, setDay] = useState("");
  const [personId, setPersonId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fillTime, setFillTime] = useState<{ day: string; start: string; end: string } | null>(null);
  const [bar, setBar] = useState<{ kind: ShiftKind; start: string; end: string }>({ kind: "work", start: "10:00", end: "19:00" });
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const drafted = useRef(new Set<string>());

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
      // 「シフトを見る」の日にちから来たときは、その日・その期間・そのお店の「日ごと」を開く
      const q = new URLSearchParams(window.location.search);
      const qd = q.get("day"), qs = q.get("storeId");
      const target = qd ? p.find((x) => x.start <= qd && qd <= x.end) : undefined;
      if (target && qd) {
        setView({ start: target.start, end: target.end, label: target.label }); setDay(qd); setMode("day");
        if (qs && s.some((x) => x.id === qs)) setStoreId(qs);
        return;
      }
      if (d) setView({ start: d.start, end: d.end, label: d.label });
    });
  }, [me.storeId]);

  const load = useCallback(async () => {
    const p = await api<PeriodRow[]>("/api/periods"); setPeriods(p);
    const db = p.find((x) => x.start === view.start);
    if (!final) setRoster(sortRoster(await api<Person[]>(`/api/roster?storeId=${storeId}`)));
    if (!db) { setShifts([]); setReqs([]); setEditable(false); setLoadedKey(`${storeId}|${view.start}`); return; }
    const getAtt = () => api<{ rows: AttendanceRow[]; editable: boolean; roster: Person[] }>(`/api/attendance?periodId=${db.id}&storeId=${storeId}`);
    const [s, r] = await Promise.all([
      final ? getAtt().then(async (a0) => {
        let a = a0;
        // はじめて開いたとき（まだ何も入っていない）は、シフト（出勤簿予定）のとおりに自動で入れる
        const k = `${storeId}|${view.start}`;
        if (a.editable && a.rows.length === 0 && !drafted.current.has(k)) {
          drafted.current.add(k);
          try { await api("/api/attendance", { action: "draft", periodId: db.id, storeId }); a = await getAtt(); } catch { /* 入れられなくても、表は開く */ }
        }
        setRoster(sortRoster(a.roster));
        return { shifts: a.rows.map(asShift), editable: a.editable };
      }) : api<{ shifts: ShiftRow[]; editable: boolean }>(`/api/shifts?periodId=${db.id}&storeId=${storeId}`),
      api<RequestRow[]>(`/api/requests?periodId=${db.id}`),
    ]);
    setShifts(s.shifts); setEditable(s.editable); setReqs(r); setLoadedKey(`${storeId}|${view.start}`);
  }, [storeId, view.start, final]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { if (!target) load().catch(() => {}); });

  useEffect(() => { if (!days.includes(day)) { const t = todayJst(); setDay(days.includes(t) ? t : days[0]); } }, [view.start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!roster.find((r) => r.id === personId)) setPersonId(roster[0]?.id ?? ""); }, [roster, personId]);
  useEffect(() => { setBar((b) => ({ ...b, start: defaults.start, end: defaults.end })); }, [defaults.start, defaults.end]);
  useEffect(() => { if (typeof window !== "undefined" && window.innerWidth >= 900) setMode("table"); }, []);

  const byKey = useMemo(() => new Map(shifts.map((s) => [`${s.membershipId}|${s.day}`, s])), [shifts]);
  const reqKey = useMemo(() => new Map(reqs.map((r) => [`${r.membershipId}|${r.day}`, r.kind])), [reqs]);
  const periodId = dbPeriod?.id;

  const post = async (body: Record<string, unknown>) => {
    try {
      setMsg("");
      let count = 0;
      if (!final) count = (await api<{ count: number }>("/api/shifts", { periodId, storeId, ...body })).count;
      else {
        const a = body.action;
        if (a === "save") count = (await api<{ count: number }>("/api/attendance", { periodId, storeId, action: "save", entries: (body.entries as ShiftEntry[]).map((e) => ({ membershipId: e.membershipId, day: e.day, kind: e.kind, clockIn: e.start, clockOut: e.end, breakMin: e.breakMin ?? undefined })) })).count;
        else if (a === "clear") count = (await api<{ count: number }>("/api/attendance", { periodId, storeId, action: "clear", items: body.items })).count;
        else if (a === "fill") count = (await api<{ saved: number }>("/api/attendance", { periodId, storeId, action: "fill", days: body.days, clockIn: body.start, clockOut: body.end, overwrite: true })).saved;
        else if (a === "autoDraft") count = (await api<{ count: number }>("/api/attendance", { periodId, storeId, action: "draft" })).count;
      }
      await load(); return count;
    }
    catch (e) { setMsg((e as Error).message); throw e; }
  };
  const save = async (entries: ShiftEntry[]) => { await post({ action: "save", entries }); };
  const loading = loadedKey !== `${storeId}|${view.start}`;
  const readOnlyReason = loading ? "" : !dbPeriod ? "この期間は、まだ作成されていません。" : editable ? "" : storeId !== me.storeId && me.level < 4 ? "他のお店の出勤簿です（見るだけ）。" : final ? "いまは出勤簿確定を変更できません（提出済み・確認済みなど）。" : pstatus === "preparing" ? "まだ準備中です。希望休の受付を始めるか、出勤簿づくりを始めると入力できます。" : "いまは出勤簿を変更できません（確定済みなど）。";

  const dayCount = (d: string) => roster.filter((r) => byKey.get(`${r.id}|${d}`)?.kind === "work").length;

  return (
    <>
      <SubTabs items={[{ href: "/admin/periods", label: "やること" }, { href: "/admin/shifts", label: "出勤簿予定" }, { href: "/admin/attendance", label: "出勤簿確定" }]} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h1 style={{ margin: 0 }}>{final ? "出勤簿確定" : "出勤簿予定"}</h1>
        <button className="ghost noprint" style={{ width: "auto", margin: 0 }} onClick={() => window.print()}>🖨 プリント</button>
      </div>
      <p className="printonly" style={{ fontSize: 12, margin: "2px 0 6px" }}>{store?.name}　{view.label}</p>
      <p className="hint">{final ? "実際の勤務の出勤簿です（同期・税務署に出す用）。はじめは出勤簿予定のとおりに入ります。実際に変わったところを、ここで直します。" : "シフトの予定です。"}表で直します。<b>日付を押す</b>＝その日の全員をまとめて直す　<b>名前を押す</b>＝その人の日をまとめて直す　<b>マスを押す</b>＝1か所だけ直す</p>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.filter((s) => me.level === 4 || s.id === me.storeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <p className="sub" style={{ margin: "0 0 8px" }}>{store?.name}：{loading ? "読み込み中…" : pstatus ? STATUS_LABEL[pstatus] : "未作成"}　{readOnlyReason && <b style={{ color: "#b45309" }}>{readOnlyReason}</b>}</p>
      {editable && !loading && (
        <details className="card" style={{ marginBottom: 8, padding: "8px 12px" }} open={shifts.length === 0}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>まとめて入れる・上限・貼り付け</summary>
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => { const n = await post({ action: "autoDraft" }); setNote(final ? `出勤簿予定の内容を、出勤簿確定に${n}件、反映しました（すでに入っているところは、そのままです）` : `シフトカレンダー（休み・有給）の内容を、出勤簿に${n}件、反映しました（すでに入っているところは、そのままです）`); }}>{final ? "出勤簿予定から反映（足りない所だけ）" : "シフトカレンダーから出勤簿に反映"}</button>
          {note && <span className="sub">{note}</span>}
          {!final && dbPeriod && <LimitAll periodId={dbPeriod.id} storeId={storeId} days={daysOf(view.start, view.end)} onDone={() => {}} />}
          {!final && <PasteOff roster={roster} start={view.start} end={view.end} onApply={save} />}
        </div>
        </details>
      )}
      {msg && <p className="err">{msg}</p>}

      <div className="tintbox" style={tintStyle(view.start)}>
        {/* ------------------------------------------------ 日ごと */}
        {mode === "day" && (
          <div className="sheet-bg" onClick={() => setMode("table")}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto", width: "100%", maxWidth: 760 }}>
          <button className="ghost" style={{ width: "auto", margin: "0 0 8px" }} onClick={() => setMode("table")}>✕ 表にもどる</button>
          <>
            <div className="daystrip">
              {days.map((d) => (
                <button key={d} className={`${d === day ? "on" : ""} ${holidayName(d) ? "hol" : ""} ${dow(d) === 0 ? "su" : dow(d) === 6 ? "sa" : ""}`} onClick={() => setDay(d)}>
                  <small>{holidayName(d) ?? WEEKDAYS[dow(d)]}</small><b>{md(d)}</b><small>{dayCount(d)}人</small>
                </button>
              ))}
            </div>
            <div className="card" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <button className="ghost" style={{ width: "auto", margin: 0 }} disabled={days.indexOf(day || days[0]) <= 0} onClick={() => setDay(days[days.indexOf(day || days[0]) - 1])}>‹ 前の日</button>
                <b style={{ fontSize: 20 }}>{md(day || days[0])}（{WEEKDAYS[dow(day || days[0])]}）</b>
                <button className="ghost" style={{ width: "auto", margin: 0 }} disabled={days.indexOf(day || days[0]) >= days.length - 1} onClick={() => setDay(days[days.indexOf(day || days[0]) + 1])}>次の日 ›</button>
              </div>
              {editable && (() => {
                const dd = day || days[0];
                const t = fillTime && fillTime.day === dd ? fillTime : { day: dd, ...hoursOn(store, dd) };
                return (
                  <div style={{ marginTop: 10 }}>
                    <div className="times">
                      <label>入店<input type="time" step={300} value={t.start} onChange={(e) => setFillTime({ ...t, start: e.target.value })} /></label>
                      <label>退店<input type="time" step={300} value={t.end} onChange={(e) => setFillTime({ ...t, end: e.target.value })} /></label>
                    </div>
                    <div className="sub" style={{ margin: "6px 0" }}>{hoursText(t.start, t.end, me.breakRule)}（この日だけの時間です。休み・有給の人は変わりません。ちがう時間の人は、名前を押して、ひとりずつ直せます）</div>
                    <button style={{ padding: 12, fontSize: 15 }} disabled={!t.start || !t.end || t.end <= t.start} onClick={async () => { const n = await post({ action: "fill", days: [dd], start: t.start, end: t.end, overwrite: true, keepOff: true }); setNote(`${n}人分を、${t.start}〜${t.end} に直しました（休み・有給の人は、そのままです）`); }}>
                      この日の出勤の人を、全員 {t.start}〜{t.end} に直す
                    </button>
                  </div>
                );
              })()}
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
          </div></div>
        )}

        {/* ------------------------------------------------ 人ごと */}
        {mode === "person" && (
          <div className="sheet-bg" onClick={() => setMode("table")}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto", width: "100%", maxWidth: 760 }}>
          <button className="ghost" style={{ width: "auto", margin: "0 0 8px" }} onClick={() => setMode("table")}>✕ 表にもどる</button>
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
                  <button key={d} className={`d cellp ${kindClass(s)} ${picked.has(d) ? "pick" : ""} ${holidayName(d) ? "hol" : ""}`} disabled={!editable}
                    onClick={() => setPicked((p) => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; })}>
                    <span>{md(d)}</span>{holidayName(d) && <small className="holname">{holidayName(d)}</small>}<small>{cellText(s)}</small>{r && <i className="dot" title="希望休" />}
                  </button>
                );
              })}
            </div>
            {editable && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="seg">{KIND_BUTTONS.map((k) => <button key={k.kind} className={bar.kind === k.kind ? "on" : ""} onClick={() => setBar({ ...bar, kind: k.kind })}>{k.label}</button>)}</div>
                {bar.kind === "work" && (
                  <>
                    <div className="times"><label>入店<input type="time" step={300} value={bar.start} onChange={(e) => setBar({ ...bar, start: e.target.value })} /></label>
                      <label>退店<input type="time" step={300} value={bar.end} onChange={(e) => setBar({ ...bar, end: e.target.value })} /></label></div>
                    <div className="sub" style={{ margin: "6px 0" }}>{hoursText(bar.start, bar.end, me.breakRule)}{store?.satOpen && bar.start === defaults.start && bar.end === defaults.end ? `（土曜は自動で ${store.satOpen}〜${store.satClose} になります）` : ""}</div>
                  </>
                )}
                <div className="actions" style={{ marginTop: 8 }}>
                  <button style={{ width: "auto", margin: 0, flex: 1 }} disabled={picked.size === 0}
                    onClick={async () => { await save([...picked].map((d) => { const h = bar.kind === "work" && bar.start === defaults.start && bar.end === defaults.end ? hoursOn(store, d) : { start: bar.start, end: bar.end }; return { membershipId: personId, day: d, kind: bar.kind, start: h.start, end: h.end }; })); setPicked(new Set()); }}>
                    選んだ日（{picked.size}日）に入れる
                  </button>
                  <button className="ghost" disabled={picked.size === 0} onClick={async () => { await post({ action: "clear", items: [...picked].map((d) => ({ membershipId: personId, day: d })) }); setPicked(new Set()); }}>消す</button>
                </div>
              </div>
            )}
          </>
          </div></div>
        )}

        {/* ------------------------------------------------ 一覧表 */}
        {(
          <div className="scroll">
            <table className="shifttable atttable">
              <thead><tr><th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 2 }}>名前</th><th></th>{days.map((d) => <th key={d} title="押すと、この日の全員を一括・個別で直せます" style={{ cursor: "pointer" }} onClick={() => { setDay(d); setMode("day"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={dow(d) === 0 || holidayName(d) ? "su" : dow(d) === 6 ? "sa" : ""}>{md(d)}<br /><small>{WEEKDAYS[dow(d)]}</small>{holidayName(d) && <><br /><small className="holname" style={{ fontSize: 9 }}>{holidayName(d)}</small></>}</th>)}<th>合計</th></tr></thead>
              <tbody>
                {roster.map((p) => {
                  const tot = days.reduce((a, d) => { const s = byKey.get(`${p.id}|${d}`); if (s?.kind === "work") { a.days++; a.min += shiftHours(s, me.breakRule).work; } else if (s?.kind === "paid") a.paid++; return a; }, { days: 0, min: 0, paid: 0 });
                  return ["適用", "入店", "退店", "休憩", "実働"].map((label, li) => (
                    <tr key={`${p.id}${label}`} className={li === 0 ? "pstart" : ""}>
                      {li === 0 && <td rowSpan={5} className="name" style={{ cursor: "pointer", position: "sticky", left: 0, background: "#fff", zIndex: 1 }} title="押すと、この人の日をまとめて直せます" onClick={() => { setPersonId(p.id); setPicked(new Set()); setMode("person"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{p.name}</td>}
                      <td className="lbl">{label}</td>
                      {days.map((d) => {
                        const s = byKey.get(`${p.id}|${d}`), r = reqKey.get(`${p.id}|${d}`);
                        return <td key={d} className={`${kindClass(s)} ${editable ? "click" : ""} ${label === "実働" ? "wk" : ""}`} onClick={() => editable && setTarget({ person: p, days: [d] })}>{attendanceLines(s, me.breakRule)[li]}{li === 0 && r && !s && <i className="dot" />}</td>;
                      })}
                      {li === 0 && <td rowSpan={5} className="tot"><b>{fmt(tot.min)}</b><div className="sub">{tot.days}日</div><div className="sub">有給{tot.paid}</div></td>}
                    </tr>
                  ));
                })}
                <tr className="sumrow"><td className="name">出勤人数</td><td></td>{days.map((d) => <td key={d}>{dayCount(d)}</td>)}<td></td></tr>
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
          initial={byKey.get(`${target.person.id}|${target.days[0]}`)} defaults={hoursOn(store, target.days[0])}
          onSave={(e) => save([{ membershipId: target.person.id, day: target.days[0], ...e }])}
          onClear={async () => { await post({ action: "clear", items: [{ membershipId: target.person.id, day: target.days[0] }] }); }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
