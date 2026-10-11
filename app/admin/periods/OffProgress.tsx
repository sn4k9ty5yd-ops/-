"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Stepper } from "@/app/Stepper";
import { api, useAutoRefresh } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { daysOf, shortNames, WEEKDAYS } from "@/lib/labels";
import { nameColor, RANK_LEGEND, YEAR1_GREEN, YEAR2_BLUE } from "@/lib/rank-color";

type Person = { id: string; name: string; shortName?: string | null; rank?: string | null; assistantYear?: number | null };
type Req = { membershipId: string; storeId: string; day: string; kind: string };
type Sh = { membershipId: string; day: string; kind: string };
type Lim = { day: string; maxStylist: number | null; maxAssistant: number | null; maxAssistant1: number | null; maxAssistant2: number | null };
const KIND: Record<string, string> = { hope: "公休希望", paid: "有給", holiday: "公休", off: "休み", other: "他" };

/** 「つくる」: 作成中のシフトの、希望休の進み具合。日ごとに、スタイリスト・アシスタントが何人休むか／上限を見て、その場で上限を変えられる */
export function OffProgress({ periodId, storeId, start, end, canEdit }: { periodId: string; storeId: string; start: string; end: string; canEdit: boolean }) {
  const [roster, setRoster] = useState<Person[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [shifts, setShifts] = useState<Sh[]>([]);
  const [lims, setLims] = useState<Lim[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [edSty, setEdSty] = useState("0"); const [edA1, setEdA1] = useState("0"); const [edA2, setEdA2] = useState("0");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, rq, sh, dl] = await Promise.all([
        api<Person[]>(`/api/roster?storeId=${storeId}`),
        api<Req[]>(`/api/requests?periodId=${periodId}`).catch(() => [] as Req[]),
        api<{ shifts: Sh[] }>(`/api/shifts?periodId=${periodId}&storeId=${storeId}`).catch(() => ({ shifts: [] as Sh[] })),
        api<{ limits: Lim[] }>(`/api/day-limits?periodId=${periodId}&storeId=${storeId}`).catch(() => ({ limits: [] as Lim[] })),
      ]);
      setRoster(r); setReqs(rq.filter((x) => x.storeId === storeId)); setShifts(sh.shifts); setLims(dl.limits); setMsg("");
    } catch (e) { setMsg((e as Error).message); }
  }, [periodId, storeId]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => { if (!sel) load(); });

  const rank = useMemo(() => new Map(roster.map((p) => [p.id, p.rank ?? null])), [roster]);
  const color = useMemo(() => new Map(roster.map((p) => [p.id, nameColor(p.rank, p.assistantYear)])), [roster]);
  const yearOf = useMemo(() => new Map(roster.map((p) => [p.id, p.assistantYear ?? null])), [roster]);
  const short = useMemo(() => shortNames(roster), [roster]);
  const limOf = useMemo(() => new Map(lims.map((l) => [l.day, l])), [lims]);
  // その日に休む人（シフトに休みが入っていればそれを優先。なければ、出された希望休）
  const offBy = useMemo(() => {
    const m = new Map<string, { id: string; kind: string }[]>();
    const seen = new Set<string>();
    for (const s of shifts) if (s.kind !== "work") { const k = `${s.membershipId}|${s.day}`; seen.add(k); m.set(s.day, [...(m.get(s.day) ?? []), { id: s.membershipId, kind: s.kind }]); }
    for (const r of reqs) { const k = `${r.membershipId}|${r.day}`; if (seen.has(k)) continue; m.set(r.day, [...(m.get(r.day) ?? []), { id: r.membershipId, kind: r.kind }]); }
    return m;
  }, [shifts, reqs]);
  const submitted = useMemo(() => new Set(reqs.map((r) => r.membershipId)), [reqs]);
  const days = useMemo(() => daysOf(start, end), [start, end]);
  const lead = days.length ? new Date(days[0] + "T00:00:00Z").getUTCDay() : 0;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);

  const count = (day: string, r: "stylist" | "assistant") => (offBy.get(day) ?? []).filter((p) => rank.get(p.id) === r).length;
  const countY = (day: string, y: 1 | 2) => (offBy.get(day) ?? []).filter((p) => rank.get(p.id) === "assistant" && yearOf.get(p.id) === y).length;
  const over = (day: string) => { const l = limOf.get(day); return !!l && ((l.maxStylist !== null && count(day, "stylist") > l.maxStylist) || (l.maxAssistant !== null && count(day, "assistant") > l.maxAssistant) || (l.maxAssistant1 !== null && countY(day, 1) > l.maxAssistant1) || (l.maxAssistant2 !== null && countY(day, 2) > l.maxAssistant2)); };
  const overDays = days.filter(over).length;
  const open = (day: string) => {
    const l = limOf.get(day); const tot = l?.maxAssistant ?? 0;
    setEdSty(String(l?.maxStylist ?? 0));
    setEdA1(String(l?.maxAssistant1 ?? Math.ceil(tot / 2))); setEdA2(String(l?.maxAssistant2 ?? Math.floor(tot / 2)));   // 1年目・2年目が未設定のときは、いまの合計を半分ずつにしてから始める
    setSel(day); setMsg("");
  };
  const save = async () => {
    if (!sel) return; setBusy(true);
    try { await api("/api/day-limits", { periodId, storeId, days: [sel], maxStylist: Number(edSty), maxAssistant1: Number(edA1), maxAssistant2: Number(edA2) }); setSel(null); await load(); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const notYet = roster.filter((p) => !submitted.has(p.id));
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WEEKDAYS[new Date(d + "T00:00:00Z").getUTCDay()]}）`;

  return (
    <div className="card" style={{ margin: "10px 0" }}>
      <b style={{ fontSize: 18 }}>📅 いま作成中の、希望休の進み具合</b>
      <p className="sub" style={{ margin: "4px 0" }}>日ごとに、<b>スタイリスト（👔）・アシスタント（🌱）が何人休むか／上限</b>が出ます。日にちを押すと、休む人の名前を見ながら、上限を変えられます。</p>
      <p className="sub" style={{ margin: "2px 0" }}>名前の色：{RANK_LEGEND.map(([t, c], i) => <span key={t}>{i > 0 && "　"}<b style={{ color: c }}>{t}</b></span>)}</p>
      <p style={{ margin: "6px 0" }}>希望休を出した人：<b>{roster.length - notYet.length}人</b> ／ {roster.length}人　{overDays > 0 ? <span className="chip" style={{ color: "var(--bad)" }}>⚠ 上限をこえた日 {overDays}日</span> : <span className="chip">上限をこえた日はありません</span>}</p>
      {notYet.length > 0 && <details><summary className="sub" style={{ cursor: "pointer" }}>まだ出していない人（{notYet.length}人）</summary><p className="sub" style={{ margin: "4px 0" }}>{notYet.map((p, k) => <span key={p.id} style={{ color: nameColor(p.rank, p.assistantYear) }}>{k > 0 && "、"}{p.name}</span>)}</p></details>}
      {msg && <p className="err">{msg}</p>}
      <div className="offgrid">
        {WEEKDAYS.map((w, i) => <div key={w} className="offhead" style={{ color: i === 0 ? "#d70015" : i === 6 ? "#0a6cf0" : undefined }}>{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const l = limOf.get(d); const cs = count(d, "stylist"), ca = count(d, "assistant"); const bad = over(d); const hol = holidayName(d);
          const etc = (offBy.get(d) ?? []).length - cs - ca;
          return (
            <button key={d} className="offday ghost" style={{ borderColor: bad ? "var(--bad)" : undefined, background: bad ? "rgba(215,0,21,.08)" : undefined }} onClick={() => open(d)}>
              <b style={{ color: hol ? "#d70015" : undefined }}>{Number(d.slice(8, 10))}</b>
              <span className="offline" style={{ color: l?.maxStylist !== null && l && cs > (l.maxStylist ?? 99) ? "var(--bad)" : undefined }}>👔{cs}/{l?.maxStylist ?? "－"}</span>
              {l && l.maxAssistant1 !== null && l.maxAssistant2 !== null ? (<>
                <span className="offline" style={{ color: countY(d, 1) > l.maxAssistant1 ? "var(--bad)" : YEAR1_GREEN }}>🌱①{countY(d, 1)}/{l.maxAssistant1}</span>
                <span className="offline" style={{ color: countY(d, 2) > l.maxAssistant2 ? "var(--bad)" : YEAR2_BLUE }}>🌱②{countY(d, 2)}/{l.maxAssistant2}</span>
              </>) : <span className="offline" style={{ color: l?.maxAssistant !== null && l && ca > (l.maxAssistant ?? 99) ? "var(--bad)" : undefined }}>🌱{ca}/{l?.maxAssistant ?? "－"}</span>}
              <span className="offnames">{(offBy.get(d) ?? []).map((p, k) => <span key={p.id} style={{ color: color.get(p.id) ?? "var(--sub)" }}>{k > 0 && "・"}{short.get(p.id) ?? ""}</span>)}</span>
            </button>
          );
        })}
      </div>
      {sel && createPortal(
        <div className="sheet-bg" onClick={() => setSel(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="この日の休みと上限" style={{ maxHeight: "90vh", overflow: "auto" }}>
            <h3 style={{ margin: "0 0 6px" }}>{md(sel)}</h3>
            <p className="sub" style={{ margin: "0 0 6px" }}>いま休む人（希望休・休み）：👔スタイリスト {count(sel, "stylist")}人　🌱アシスタント {count(sel, "assistant")}人（1年目 {(offBy.get(sel) ?? []).filter((p) => rank.get(p.id) === "assistant" && yearOf.get(p.id) === 1).length}人・2年目 {(offBy.get(sel) ?? []).filter((p) => rank.get(p.id) === "assistant" && yearOf.get(p.id) === 2).length}人）</p>
            <ul className="list">
              {(offBy.get(sel) ?? []).length === 0 ? <li><span className="sub">まだ、だれも出していません</span></li> :
                (offBy.get(sel) ?? []).map((p) => <li key={p.id}><span style={{ color: color.get(p.id), fontWeight: 700 }}>{rank.get(p.id) === "stylist" ? "👔" : rank.get(p.id) === "assistant" ? "🌱" : "・"} {roster.find((x) => x.id === p.id)?.name}{rank.get(p.id) === "assistant" && yearOf.get(p.id) ? `（${yearOf.get(p.id)}年目）` : ""}</span><span className="chip">{KIND[p.kind] ?? p.kind}</span></li>)}
            </ul>
            {canEdit ? (
              <>
                <b>この日に休める人数（上限）</b>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
                  <span>👔スタイリスト</span><Stepper label="スタイリストの上限" unit="人" max={99} value={edSty} onChange={setEdSty} />
                  <span style={{ color: YEAR1_GREEN }}>🌱1年目</span><Stepper label="アシスタント1年目の上限" unit="人" max={99} value={edA1} onChange={setEdA1} />
                  <span style={{ color: YEAR2_BLUE }}>🌱2年目</span><Stepper label="アシスタント2年目の上限" unit="人" max={99} value={edA2} onChange={setEdA2} />
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="sub" style={{ margin: 0 }}>アシスタント全体の上限：{Number(edA1) + Number(edA2)}人（1年目＋2年目）</p>
                  <button disabled={busy} onClick={save}>この日の上限を保存</button>
                  <button className="ghost" onClick={() => setSel(null)}>閉じる</button>
                </div>
              </>
            ) : <button className="ghost" style={{ width: "100%" }} onClick={() => setSel(null)}>閉じる</button>}
            {msg && <p className="err">{msg}</p>}
          </div>
        </div>, document.body)}
    </div>
  );
}
