"use client";
import Link from "next/link";
import { Stepper } from "@/app/Stepper";
import { SubTabs } from "@/app/SubTabs";
import { shiftTabs, viewTabs } from "@/lib/shift-tabs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { dow, hoursOn, md, daysOf, shortNames, WEEKDAYS } from "@/lib/labels";
import { ShiftSheet } from "@/app/admin/shifts/ShiftSheet";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { STATUS_ORDER, type PeriodRow, type ShiftRow, type StoreRow } from "@/lib/service";
import { longText } from "@/lib/shift-ui";

type Person = { id: string; name: string; shortName?: string | null };
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
  const [myReq, setMyReq] = useState<Set<string>>(new Set());
  const [show, setShow] = useState<"work" | "off">("work");
  const [ready, setReady] = useState(false);
  const [editable, setEditable] = useState(false);
  const [limits, setLimits] = useState<Map<string, number>>(new Map());
  const [conflicts, setConflicts] = useState<Map<string, { maxOff: number; count: number }>>(new Map());
  const [limitInput, setLimitInput] = useState("");
  const [limitMsg, setLimitMsg] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);

  const isPub = (p: PeriodRow, sid: string) => { const st = p.stores.find((s) => s.storeId === sid); return !!st && STATUS_ORDER.indexOf(st.status) >= STATUS_ORDER.indexOf("collecting"); };

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
    if (!db) { setShifts([]); setMyReq(new Set()); setEditable(false); return; }
    const rq = me.displayOnly ? [] : await api<{ id: string; membershipId: string; storeId: string; day: string; kind: string }[]>(`/api/requests?periodId=${db.id}`).catch(() => []);
    if (!me.displayOnly) setMyReq(new Set(rq.filter((r) => r.membershipId === me.id).map((r) => r.day)));
    const sh = await api<{ shifts: ShiftRow[]; editable: boolean }>(`/api/shifts?periodId=${db.id}&storeId=${storeId}`);
    // 希望休〜シフトづくりの間は、出された希望休も「みんなの休み」に出す（シフトに入っている人は、シフトを優先）
    const stt = db.stores.find((x) => x.storeId === storeId)?.status;
    const early = !!stt && STATUS_ORDER.indexOf(stt) >= STATUS_ORDER.indexOf("collecting") && STATUS_ORDER.indexOf(stt) <= STATUS_ORDER.indexOf("drafting");
    const have = new Set(sh.shifts.map((x) => `${x.membershipId}|${x.day}`));
    const fromReq: ShiftRow[] = early ? rq.filter((r) => r.storeId === storeId && !have.has(`${r.membershipId}|${r.day}`))
      .map((r) => ({ id: `req-${r.id}`, membershipId: r.membershipId, storeId, periodId: db.id, day: r.day, kind: r.kind === "paid" ? "paid" as const : "holiday" as const, start: null, end: null })) : [];
    setShifts([...sh.shifts, ...fromReq]); setEditable(!!sh.editable && !me.displayOnly);
    if (!me.displayOnly) {
      const dl = await api<{ limits: { day: string; maxOff: number }[]; conflicts: { day: string; maxOff: number; count: number }[] }>(`/api/day-limits?periodId=${db.id}&storeId=${storeId}`).catch(() => null);
      if (dl) { setLimits(new Map(dl.limits.map((l) => [l.day, l.maxOff]))); setConflicts(new Map(dl.conflicts.map((c) => [c.day, c]))); }
    }
  }, [db, storeId, view, me.id, me.displayOnly]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { load().catch(() => {}); });

  const name = useMemo(() => new Map(roster.map((r) => [r.id, r.name])), [roster]);
  const short = useMemo(() => shortNames(roster), [roster]);
  const byDay = useMemo(() => { const m = new Map<string, ShiftRow[]>(); for (const s of shifts) m.set(s.day, [...(m.get(s.day) ?? []), s]); return m; }, [shifts]);
  if (!ready || !view) return null;
  const days = daysOf(view.start, view.end);
  const todays = (byDay.get(today) ?? []).filter((s) => s.kind === "work").sort((a, b) => (a.start! < b.start! ? -1 : 1));
  const todayOff = (byDay.get(today) ?? []).filter((s) => s.kind !== "work");
  const published = !!db && isPub(db, storeId);
  const myOff = new Set<string>(published ? shifts.filter((s) => s.membershipId === me.id && s.kind !== "work").map((s) => s.day) : myReq);
  const shiftOut = !!db && (() => { const st = db.stores.find((x) => x.storeId === storeId)?.status; return !!st && STATUS_ORDER.indexOf(st) >= STATUS_ORDER.indexOf("confirmed"); })();
  const inView = view.start <= today && today <= view.end;

  return (
    <main style={{ maxWidth: 900 }}>
      {!me.displayOnly && <Link href="/home" className="back">← ホーム</Link>}
      <h1>{me.displayOnly ? `${stores.find((x) => x.id === me.storeId)?.name ?? ""} のシフト` : "シフト"}</h1>
      {!me.displayOnly && <SubTabs items={shiftTabs(me.level)} />}
      {!me.displayOnly && <SubTabs items={viewTabs(me.level)} />}
      {!me.displayOnly && <p className="hint">ここは「見る」画面です。日にちを押すと、その日の全員が見られます。</p>}
      {(me.level >= 3) && (
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 12 }}>
          {stores.filter((s) => me.level === 4 || s.id === me.storeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {inView && shiftOut && (
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
      {(
        <div className="tintbox" style={tintStyle(view.start)}>
          {!published && <p className="sub" style={{ margin: "4px 4px 8px" }}>この期間は、まだ始まっていません（準備中）。希望休の受付が始まると、みんなの休みが見られます。</p>}
          {published && !!db && (() => { const stt = db.stores.find((x) => x.storeId === storeId)?.status; return stt === "collecting" || stt === "closed" ? <p className="sub" style={{ margin: "4px 4px 8px" }}>希望休を集めている段階です。みんなの休みが見られます（見るだけ）。日付の「休◯/◯」は、休みを出している人数／休める人数の目安です。目安をこえても希望休は出せます。{me.level >= 2 ? "日にちを押して、人ごとに直せます。" : ""}</p> : null; })()}
          <div className="mcal">
            {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
            {Array.from({ length: dow(days[0]) }).map((_, i) => <div key={`b${i}`} />)}
            {days.map((d) => {
              const list = (byDay.get(d) ?? []).filter((s) => (show === "work" ? s.kind === "work" : s.kind !== "work"));
                            return (
                <div key={d} role="button" tabIndex={0} aria-label={`${md(d)}の詳細`} onClick={() => { setLimitInput(""); setLimitMsg(""); setDetail(d); }} onKeyDown={(e) => { if (e.key === "Enter") setDetail(d); }}
                  className={`mday ${d === today ? "today" : ""} ${myOff.has(d) ? "myoff" : ""} ${holidayName(d) ? "hol" : ""} ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}`} style={{ cursor: "pointer" }}>
                  <div className="num"><span>{md(d)}</span>{holidayName(d) && <small className="holname"> {holidayName(d)}</small>}{myOff.has(d) && <small className="myoff-tag"> 休み</small>}{limits.has(d) && (() => { const n = (byDay.get(d) ?? []).filter((x) => x.kind !== "work").length, m = limits.get(d)!; return <small style={{ color: n > m ? "#d70015" : "var(--sub)", fontWeight: n > m ? 800 : 500 }}> {n > m ? "⚠" : ""}休{n}/{m}</small>; })()}</div>
                  {(byDay.get(d) ?? []).length > 0 && <span className="wcount" title="この日の出勤人数">{(byDay.get(d) ?? []).filter((s) => s.kind === "work").length}人</span>}
                  {list.length === 0 && show === "off" ? <small className="sub">なし</small> : (
                    <div className="names">
                      {list.map((s, i) => (
                        <span key={s.id} className={s.membershipId === me.id ? "me" : ""}>{i > 0 && "・"}{short.get(s.membershipId) ?? ""}{show === "off" && s.kind === "paid" ? "🈶" : ""}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!me.displayOnly && <p className="hint">日にちを押すと、その日の全員が見られます。自分の名前は太字、自分の休みの日は <b style={{ color: "#d70015" }}>赤い丸</b> で表示されます。</p>}
      {detail && (() => {
        const rows = byDay.get(detail) ?? [];
        const work = rows.filter((r) => r.kind === "work").sort((a, b) => ((a.start ?? "") < (b.start ?? "") ? -1 : 1));
        const off = rows.filter((r) => r.kind !== "work");
        const none = roster.filter((p) => !rows.some((r) => r.membershipId === p.id));
        const row = (id: string, label: string, tag?: string) => (
          <li key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span><b style={id === me.id ? { color: "var(--blue)" } : undefined}>{name.get(id) ?? ""}{id === me.id && "（あなた）"}</b>{tag && <span className="chip" style={{ marginLeft: 8 }}>{tag}</span>}{label && <span className="sub"> {label}</span>}</span>
            {editable && <button className="ghost" style={{ color: "var(--blue)", width: "auto", padding: "6px 10px" }} onClick={() => setEditTarget({ id, name: name.get(id) ?? "" })}>編集</button>}
          </li>
        );
        return (
          <div className="sheet-bg" onClick={() => setDetail(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${md(detail)}の詳細`} style={{ maxHeight: "85vh", overflow: "auto" }}>
              <b style={{ fontSize: 20 }}>{md(detail)}（{WEEKDAYS[dow(detail)]}）</b>{holidayName(detail) && <small className="holname"> {holidayName(detail)}</small>}
              {me.level >= 2 && (
                <Link href={`/admin/shifts?day=${detail}&storeId=${storeId}`} className="btn" style={{ display: "block", textAlign: "center", margin: "10px 0", padding: 12, borderRadius: 14, background: "var(--blue)", color: "#fff", fontWeight: 700, textDecoration: "none" }}>
                  この日の出勤簿を開く（全員一括・ひとりずつ直せます）
                </Link>
              )}
              {me.level < 2 && limits.has(detail) && <p className="sub" style={{ margin: "6px 0" }}>この日に休める人数の目安：{limits.get(detail)}人（いま{off.length}人が休み）。目安をこえても希望休は出せます。</p>}
              {me.level >= 2 && db && (
                <div className="card" style={{ margin: "8px 0", padding: 10 }}>
                  <div className="sub">この日に休める人数の上限（出勤簿をつける人が決めます）</div>
                  {conflicts.has(detail) && <p style={{ color: "#d70015", margin: "4px 0", fontWeight: 700 }}>⚠ いま{conflicts.get(detail)!.count}人が休み（上限{conflicts.get(detail)!.maxOff}人）。かぶっています。</p>}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Stepper label="休める人数の上限" unit="人" max={99} value={limitInput !== "" ? limitInput : limits.has(detail) ? String(limits.get(detail)) : ""} placeholder="なし" onChange={setLimitInput} />
                    <span>人まで</span>
                    <button style={{ width: "auto", margin: 0, padding: "8px 12px" }} onClick={async () => { try { await api("/api/day-limits", { periodId: db.id, storeId, days: [detail], maxOff: limitInput === "" ? null : Number(limitInput) }); setLimitInput(""); setLimitMsg("決めました"); await load(); } catch (e) { setLimitMsg((e as Error).message); } }}>決める</button>
                    <button className="ghost" style={{ width: "auto", margin: 0 }} onClick={async () => { try { await api("/api/day-limits", { periodId: db.id, storeId, days: [detail], maxOff: null }); setLimitInput(""); setLimitMsg("上限をなくしました"); await load(); } catch (e) { setLimitMsg((e as Error).message); } }}>上限なし</button>
                  </div>
                  {conflicts.has(detail) && (
                    <div className="actions" style={{ marginTop: 8 }}>
                      <button className="ghost" style={{ color: "var(--blue)", width: "auto", margin: 0 }} onClick={async () => { try { const r = await api<{ people: number }>("/api/day", { action: "notify", periodId: db.id, storeId, day: detail }); setLimitMsg(`${r.people}人に知らせました`); } catch (e) { setLimitMsg((e as Error).message); } }}>かぶっている人に知らせる</button>
                      <Link href={`/conflict?periodId=${db.id}&storeId=${storeId}&day=${detail}`}>話し合いを見る</Link>
                    </div>
                  )}
                  {limitMsg && <div className="sub">{limitMsg}</div>}
                </div>
              )}
              {!published ? <p className="hint">この期間は、まだ始まっていません。</p> : (
                <>
                  <h3 style={{ margin: "12px 0 4px" }}>出勤（{work.length}人）</h3>
                  {work.length === 0 ? <p className="sub">出勤の記載はありません。</p> : <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{work.map((r) => row(r.membershipId, longText(r)))}</ul>}
                  <h3 style={{ margin: "12px 0 4px" }}>お休み（{off.length}人）</h3>
                  {off.length === 0 ? <p className="sub">お休みの人はいません。</p> : <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{off.map((r) => row(r.membershipId, "", LABEL[r.kind]))}</ul>}
                  {editable && none.length > 0 && (
                    <>
                      <h3 style={{ margin: "12px 0 4px" }}>まだ入っていない人（{none.length}人）</h3>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{none.map((p) => row(p.id, "未設定"))}</ul>
                    </>
                  )}
                </>
              )}
              <button className="ghost" style={{ color: "var(--ink)", width: "100%", marginTop: 12 }} onClick={() => setDetail(null)}>閉じる</button>
            </div>
          </div>
        );
      })()}
      {editTarget && detail && db && (
        <ShiftSheet
          title={`${editTarget.name}　${md(detail)}（${WEEKDAYS[dow(detail)]}）`}
          initial={shifts.find((r) => r.membershipId === editTarget.id && r.day === detail)}
          defaults={hoursOn(stores.find((x) => x.id === storeId), detail)}
          onSave={async (e) => { await api("/api/shifts", { action: "save", periodId: db.id, storeId, entries: [{ membershipId: editTarget.id, day: detail, ...e }] }); await load(); }}
          onClear={async () => { await api("/api/shifts", { action: "clear", periodId: db.id, storeId, items: [{ membershipId: editTarget.id, day: detail }] }); await load(); }}
          onClose={() => setEditTarget(null)}
        />
      )}
      {me.displayOnly && <button className="ghost" style={{ color: "var(--sub)", width: "auto", marginTop: 24 }} onClick={logout}>ログアウト</button>}
    </main>
  );
}
export default function ShiftsView() { return <MeProvider><Page /></MeProvider>; }
