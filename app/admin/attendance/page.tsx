"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { reiwaRange } from "@/lib/era";
import { fmt } from "@/lib/hours";
import { daysOf, dow, hoursOn, md, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { attDetail, attKindText, totalsOf } from "@/lib/attendance-ui";
import { ATTENDANCE_LABEL, type AttendanceRow, type AttendanceStatus, type PeriodRow, type StoreRow } from "@/lib/service";
import { kindClass } from "@/lib/shift-ui";
import { AttendanceSheet } from "./AttendanceSheet";

type Person = { id: string; name: string; status: string };
type Mode = "day" | "table" | "total";
const rowAsShift = (r?: AttendanceRow) => (r ? ({ kind: r.kind } as never) : undefined);

export default function AttendancePage() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [view, setView] = useState<Period>(() => periodFor(todayJst(), me.closingStartDay));
  const [mode, setMode] = useState<Mode>("day");
  const [roster, setRoster] = useState<Person[]>([]);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [editable, setEditable] = useState(false);
  const [day, setDay] = useState("");
  const [target, setTarget] = useState<{ person: Person; day: string } | null>(null);
  const [bulk, setBulk] = useState({ from: "", to: "", start: "10:00", end: "19:00", overwrite: false });
  const [showBulk, setShowBulk] = useState(false);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");
  const [loadedKey, setLoadedKey] = useState("");

  const store = stores.find((s) => s.id === storeId);
  const defaults = useMemo(() => ({ start: store?.defaultOpen ?? "10:00", end: store?.defaultClose ?? "19:00" }), [store]);
  const dbp = periods.find((p) => p.start === view.start);
  const sps = dbp?.stores.find((s) => s.storeId === storeId);
  const attStatus: AttendanceStatus = sps?.attendanceStatus ?? "open";
  const days = daysOf(view.start, view.end);
  const periodId = dbp?.id;
  const loading = loadedKey !== `${storeId}|${view.start}`;

  useEffect(() => { Promise.all([api<StoreRow[]>("/api/stores"), api<PeriodRow[]>("/api/periods")]).then(([s, p]) => { setStores(s.filter((x) => x.status === "active")); setPeriods(p); }); }, []);
  const load = useCallback(async () => {
    const p = await api<PeriodRow[]>("/api/periods"); setPeriods(p);
    const db = p.find((x) => x.start === view.start);
    const key = `${storeId}|${view.start}`;
    if (!db) { setRows([]); setRoster([]); setEditable(false); setLoadedKey(key); return; }
    const a = await api<{ rows: AttendanceRow[]; editable: boolean; roster: Person[] }>(`/api/attendance?periodId=${db.id}&storeId=${storeId}`);
    setRows(a.rows); setEditable(a.editable); setRoster(a.roster); setLoadedKey(key);
  }, [storeId, view.start]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { if (!target) load().catch(() => {}); });
  useEffect(() => { if (!days.includes(day)) { const t = todayJst(); setDay(days.includes(t) ? t : days[0]); setBulk((b) => ({ ...b, from: days[0], to: days[days.length - 1] })); } }, [view.start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBulk((b) => ({ ...b, start: defaults.start, end: defaults.end })); }, [defaults.start, defaults.end]);
  useEffect(() => { if (window.innerWidth >= 900) setMode("table"); }, []);

  const byKey = useMemo(() => new Map(rows.map((r) => [`${r.membershipId}|${r.day}`, r])), [rows]);
  const post = async <T,>(body: object): Promise<T> => {
    try { setMsg(""); const r = await api<T>("/api/attendance", { periodId, storeId, ...body }); await load(); return r; } catch (e) { setMsg((e as Error).message); throw e; }
  };
  const canSubmit = me.level === 4 || (me.level === 3 && storeId === me.storeId);
  const reason = loading ? "" : !dbp ? "この期間は、まだ作成されていません。" : editable ? "" : attStatus !== "open" ? "提出済み・確認済みのため、変更できません。" : me.level < 4 && storeId !== me.storeId ? "他のお店の出勤簿です（見るだけ）。" : "いまは変更できません。";

  return (
    <>
      <h1 className="noprint">出勤簿</h1>
      <h1 className="printonly" style={{ fontSize: 20 }}>出　勤　簿　（{reiwaRange(view.start, view.end)}）　　店名：{store?.name}</h1>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="seg" style={{ margin: 0 }}>
          {([["day", "日ごと"], ["table", "出勤簿"], ["total", "合計・有給"]] as [Mode, string][]).map(([m, l]) => <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{l}</button>)}
        </div>
      </div>
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <p className="sub" style={{ margin: "0 0 8px" }}>{store?.name}：出勤簿 {loading ? "読み込み中…" : ATTENDANCE_LABEL[attStatus]}　{reason && <b style={{ color: "#b45309" }}>{reason}</b>}</p>

      {!loading && dbp && (
        <div className="actions" style={{ marginBottom: 10 }}>
          {editable && <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => { const r = await post<{ count: number }>({ action: "draft" }); setNote(`シフトから${r.count}件の下書きを作りました`); }}>シフトから下書きを作る</button>}
          {editable && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setShowBulk(!showBulk)}>まとめて入力</button>}
          {canSubmit && attStatus === "open" && <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => confirm("出勤簿をオフィスに提出しますか？（提出後は店長は直せません）") && post({ action: "status", status: "submitted" })}>オフィスに提出する</button>}
          {me.level === 4 && attStatus === "submitted" && <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => post({ action: "status", status: "acknowledged" })}>確認済みにする</button>}
          {me.level === 4 && attStatus !== "open" && <button className="ghost" style={{ color: "var(--sub)" }} onClick={() => confirm("入力中に戻しますか？") && post({ action: "status", status: attStatus === "acknowledged" ? "submitted" : "open" })}>ひとつ戻す</button>}
          {note && <span className="sub">{note}</span>}
          {mode === "table" && <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => window.print()}>印刷</button>}
        </div>
      )}
      {showBulk && editable && (
        <div className="card">
          <b>まとめて入力（全員を同じ時間にする）</b>
          <p className="sub" style={{ margin: "4px 0 8px" }}>シフトで休み・有給の人は除きます。一人ずつ直した日は、下のチェックを入れない限り変えません。</p>
          <div className="times"><label>開始日<select value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })}>{days.map((d) => <option key={d} value={d}>{md(d)}</option>)}</select></label>
            <label>終了日<select value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: e.target.value })}>{days.map((d) => <option key={d} value={d}>{md(d)}</option>)}</select></label></div>
          <div className="times"><label>入店<input type="time" value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: e.target.value })} /></label>
            <label>退店<input type="time" value={bulk.end} onChange={(e) => setBulk({ ...bulk, end: e.target.value })} /></label></div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={bulk.overwrite} onChange={(e) => setBulk({ ...bulk, overwrite: e.target.checked })} />一人ずつ直した日も上書きする</label>
          <button onClick={async () => {
            const sel = days.filter((d) => d >= bulk.from && d <= bulk.to);
            // 時間を直していなければ、お店の曜日ごとの営業時間（土曜など）で入れる
            const auto = bulk.start === defaults.start && bulk.end === defaults.end;
            const groups = new Map<string, string[]>();
            for (const d of sel) { const h = auto ? hoursOn(store, d) : { start: bulk.start, end: bulk.end }; const k = `${h.start}|${h.end}`; groups.set(k, [...(groups.get(k) ?? []), d]); }
            const r = { saved: 0, skippedEdited: 0 };
            for (const [k, ds] of groups) {
              const [a, b] = k.split("|");
              const x = await post<{ saved: number; skippedEdited: number }>({ action: "fill", days: ds, clockIn: a, clockOut: b, overwrite: bulk.overwrite });
              r.saved += x.saved; r.skippedEdited += x.skippedEdited;
            }
            setNote(`${r.saved}件を入れました${r.skippedEdited ? `（個別に直した${r.skippedEdited}件は、そのままにしました）` : ""}`); setShowBulk(false);
          }}>入れる</button>
        </div>
      )}
      {msg && <p className="err">{msg}</p>}

      <div className="tintbox" style={tintStyle(view.start)}>
        {mode === "day" && (
          <>
            <div className="daystrip">{days.map((d) => (
              <button key={d} className={`${d === day ? "on" : ""} ${dow(d) === 0 ? "su" : dow(d) === 6 ? "sa" : ""}`} onClick={() => setDay(d)}>
                <small>{WEEKDAYS[dow(d)]}</small><b>{md(d)}</b><small>{roster.filter((p) => byKey.get(`${p.id}|${d}`)?.kind === "work").length}人</small>
              </button>))}</div>
            <div className="card" style={{ marginTop: 10 }}>
              <b style={{ fontSize: 18 }}>{md(day || days[0])}（{WEEKDAYS[dow(day || days[0])]}）</b>
              <ul className="list" style={{ margin: "10px 0 0" }}>
                {roster.map((p) => {
                  const r = byKey.get(`${p.id}|${day}`);
                  return (
                    <li key={p.id} className="rowbtn" style={{ cursor: editable ? "pointer" : "default" }} onClick={() => editable && setTarget({ person: p, day })}>
                      <div><b>{p.name}</b>{r?.edited && <span className="chip warn">個別</span>}{r?.note && <div className="sub">{r.note}</div>}</div>
                      <span className={`pill ${kindClass(rowAsShift(r))}`}>{attDetail(r)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        {mode === "table" && (
          <div className="scroll">
            <table className="shifttable atttable">
              <thead><tr><th>名前</th><th></th>{days.map((d) => <th key={d} className={dow(d) === 0 ? "su" : dow(d) === 6 ? "sa" : ""}>{md(d)}<br /><small>{WEEKDAYS[dow(d)]}</small></th>)}<th>合計</th></tr></thead>
              <tbody>
                {roster.map((p) => {
                  const t = totalsOf(rows, p.id);
                  const lines: [string, (r?: AttendanceRow) => string][] = [
                    ["適用", (r) => attKindText(r)], ["入店", (r) => r?.clockIn ?? ""], ["退店", (r) => r?.clockOut ?? ""],
                    ["休憩", (r) => (r?.kind === "work" ? fmt(r.breakMin) : "")], ["実働", (r) => (r?.kind === "work" ? fmt(r.workMin) : "")],
                  ];
                  return lines.map(([label, f], li) => (
                    <tr key={`${p.id}${label}`} className={li === 0 ? "pstart" : ""}>
                      {li === 0 && <td className="name" rowSpan={5}>{p.name}{p.status === "disabled" && <div className="sub">退職</div>}</td>}
                      <td className="lbl">{label}</td>
                      {days.map((d) => { const r = byKey.get(`${p.id}|${d}`); return <td key={d} className={`${kindClass(rowAsShift(r))} ${editable ? "click" : ""} ${label === "実働" ? "wk" : ""}`} onClick={() => editable && setTarget({ person: p, day: d })}>{f(r)}{label === "適用" && r?.edited && <i className="dot" style={{ background: "#0071e3" }} />}</td>; })}
                      {li === 0 && <td rowSpan={5} className="tot"><b>{fmt(t.workMin)}</b><div className="sub">{t.workDays}日</div><div className="sub">有給{t.paid}</div></td>}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}

        {mode === "total" && (
          <ul className="list">
            {roster.map((p) => {
              const t = totalsOf(rows, p.id);
              return (
                <li key={p.id}>
                  <div><b>{p.name}</b>
                    <div className="sub">出勤 {t.workDays}日　実働合計 <b style={{ color: "var(--ink)" }}>{fmt(t.workMin)}</b>　有給 {t.paid}日　休み {t.off}日　公休 {t.holiday}日</div></div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="hint">「個別」「青い点」＝一人ずつ直した日です（一括入力では上書きされません）。</p>

      {target && (
        <AttendanceSheet
          title={`${target.person.name}　${md(target.day)}（${WEEKDAYS[dow(target.day)]}）`}
          initial={byKey.get(`${target.person.id}|${target.day}`)} defaults={hoursOn(store, target.day)}
          onSave={async (e) => { await post({ action: "save", entries: [{ membershipId: target.person.id, day: target.day, ...e }] }); }}
          onClear={async () => { await post({ action: "clear", items: [{ membershipId: target.person.id, day: target.day }] }); }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
