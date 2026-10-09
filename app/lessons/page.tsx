"use client";
import Link from "next/link";
import { Stepper } from "@/app/Stepper";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { dow, md, WEEKDAYS } from "@/lib/labels";
import { todayJst } from "@/lib/period-nav";
import type { LessonAssistant, LessonCategory, LessonRow, StoreRow } from "@/lib/service";

const addDays = (s: string, n: number) => { const t = new Date(s + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const MIN_CHOICES = [15, 30, 45, 60, 90, 120, 150, 180];
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
const hue = (i: number) => (i * 47 + 12) % 360;
const leafCats = (cs: LessonCategory[]) => cs.filter((c) => c.parentId || !cs.some((x) => x.parentId === c.id));
const labelIn = (cs: LessonCategory[], c: LessonCategory) => { const p = c.parentId ? cs.find((x) => x.id === c.parentId) : null; return p ? `${p.name}・${c.name}` : c.name; };
interface Meta { categories: LessonCategory[]; assistants: LessonAssistant[]; counts: Record<string, number> }

function CatRow({ c, cat }: { c: LessonCategory; cat: (x: { id?: string; name?: string; active?: boolean; move?: "up" | "down" }) => void }) {
  return (
    <div className="toolbar" style={{ margin: "4px 0", opacity: c.active ? 1 : 0.5 }}>
      <input defaultValue={c.name} aria-label="ボタンの名前" style={{ flex: 1 }} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== c.name) cat({ id: c.id, name: e.target.value }); }} />
      <button className="ghost" onClick={() => cat({ id: c.id, move: "up" })} aria-label="上へ">↑</button>
      <button className="ghost" onClick={() => cat({ id: c.id, move: "down" })} aria-label="下へ">↓</button>
      <button className="ghost" onClick={() => cat({ id: c.id, active: !c.active })}>{c.active ? "しまう" : "もどす"}</button>
    </div>
  );
}

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [tab, setTab] = useState<"record" | "report">("record");
  const [day, setDay] = useState(todayJst());
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<LessonRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState<{ a: LessonAssistant; c: LessonCategory } | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null); const [custom, setCustom] = useState(""); const [note, setNote] = useState("");
  const [edit, setEdit] = useState(false); const [all, setAll] = useState<LessonCategory[]>([]); const [newName, setNewName] = useState("");
  const [subName, setSubName] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""); const [okMsg, setOkMsg] = useState("");
  const [report, setReport] = useState<{ store: StoreRow; meta: Meta; rows: LessonRow[] }[]>([]);

  const canEdit = me.level === 4 || (storeId === me.storeId && (me.level >= 3 || !!me.eduLead));
  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const m = await api<Meta>(`/api/lessons?meta=1&storeId=${storeId}`);
      setMeta(m);
      setRows(await api<LessonRow[]>(`/api/lessons?storeId=${storeId}&from=${day}&to=${day}`));
      setMsg("");
    } catch (e) { setMsg((e as Error).message); }
  }, [storeId, day]);
  useEffect(() => { if (tab === "record") load(); }, [load, tab]);
  useAutoRefresh(() => { if (tab === "record" && !sheet && !edit) load(); });

  const loadReport = useCallback(async () => {
    const targets = storeId === "ALL" ? stores : stores.filter((s) => s.id === storeId);
    const out = [];
    for (const st of targets) {
      try {
        const [m, r] = await Promise.all([api<Meta>(`/api/lessons?meta=1&storeId=${st.id}`), api<LessonRow[]>(`/api/lessons?storeId=${st.id}&from=${ym}-01&to=${ym}-${lastDay(ym)}`)]);
        out.push({ store: st, meta: m, rows: r });
      } catch { /* 見られないお店は飛ばす */ }
    }
    setReport(out);
  }, [storeId, stores, ym]);
  useEffect(() => { if (tab === "report" && stores.length) loadReport(); }, [tab, loadReport, stores.length]);

  const tops = useMemo(() => (meta?.categories ?? []).filter((c) => !c.parentId), [meta]);
  const kidsOf = useCallback((pid: string) => (meta?.categories ?? []).filter((c) => c.parentId === pid), [meta]);
  const topIndex = useCallback((id: string) => Math.max(0, tops.findIndex((t) => t.id === id)), [tops]);
  const people = useMemo(() => {
    const a = meta?.assistants ?? [];
    const asst = a.filter((x) => x.rank === "assistant");
    return showAll || asst.length === 0 ? a : asst;
  }, [meta, showAll]);

  const labelOf = (c: LessonCategory) => { const p = c.parentId ? (meta?.categories ?? []).find((x) => x.id === c.parentId) : null; return p ? `${p.name}・${c.name}` : c.name; };
  const open = (a: LessonAssistant, c: LessonCategory) => { setSheet({ a, c }); setMinutes(null); setCustom(""); setNote(""); setMsg(""); };
  const record = async () => {
    if (!sheet) return;
    const mins = custom ? Number(custom) : minutes;
    try {
      const r = await api<{ ordinal: number }>("/api/lessons", { action: "add", storeId, assistantId: sheet.a.id, categoryId: sheet.c.id, day, minutes: mins, note });
      setOkMsg(`${sheet.a.name} さん：${labelOf(sheet.c)} ${r.ordinal}人目（回目）を記録しました`); setSheet(null); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const del = async (r: LessonRow) => {
    if (!confirm(`「${r.assistantName} ${r.category}」の記録を取り消しますか？`)) return;
    try { await api("/api/lessons", { action: "delete", id: r.id }); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const openEdit = async () => { setAll(((await api<Meta>(`/api/lessons?meta=1&storeId=${storeId}&all=1`)).categories)); setEdit(true); setMsg(""); };
  const cat = async (category: { id?: string; name?: string; active?: boolean; move?: "up" | "down"; parentId?: string }) => {
    try { await api("/api/lessons", { action: "category", storeId, category }); setAll((await api<Meta>(`/api/lessons?meta=1&storeId=${storeId}&all=1`)).categories); setNewName(""); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  };

  const reportTsv = () => report.flatMap((r) => [`${r.store.name}　${ym}`, ["名前", ...leafCats(r.meta.categories).map((c) => labelIn(r.meta.categories, c))].join("\t"),
    ...r.meta.assistants.filter((a) => r.rows.some((x) => x.assistantId === a.id)).map((a) => [a.name, ...leafCats(r.meta.categories).map((c) => { const l = r.rows.filter((x) => x.assistantId === a.id && x.categoryId === c.id); return l.length || ""; })].join("\t")),
    "", ["日付", "名前", "内容", "何人目", "時間(分)", "メモ"].join("\t"), ...[...r.rows].reverse().map((x) => [x.day, x.assistantName, x.category, x.ordinal, x.minutes ?? "", x.note].join("\t")), ""]).join("\n");

  if (!canEdit && me.level < 4) {
    return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>レッスン記録</h1><p className="hint">この画面は、教育担当・店長・管理者が使います。自分の記録は、ホームの「自分のレッスン」から見られます。</p></main>;
  }

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>レッスン記録</h1>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {me.level === 4 ? <>{tab === "report" && <option value="ALL">全店</option>}{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</> : stores.filter((s) => s.id === me.storeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {canEdit && tab === "record" && <button className="ghost" onClick={openEdit}>ボタンを編集</button>}
      </div>
      <div className="seg" style={{ maxWidth: 420 }}>
        <button className={tab === "record" ? "on" : ""} onClick={() => { setTab("record"); if (storeId === "ALL") setStoreId(me.storeId); }}>記録する</button>
        <button className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>月の報告</button>
      </div>
      {msg && !sheet && !edit && <p className="err">{msg}</p>}{okMsg && <p className="sub" style={{ color: "var(--ok)" }}>✅ {okMsg}</p>}

      {tab === "record" && (
        <>
          <div className="toolbar" style={{ justifyContent: "center" }}>
            <button className="ghost" onClick={() => setDay(addDays(day, -1))} aria-label="前の日">‹</button>
            <b style={{ fontSize: 20 }}>{md(day)}（{WEEKDAYS[dow(day)]}）{holidayName(day) && <small className="holname"> {holidayName(day)}</small>}</b>
            <button className="ghost" onClick={() => setDay(addDays(day, 1))} aria-label="次の日">›</button>
            {day !== todayJst() && <button className="ghost" onClick={() => setDay(todayJst())}>今日</button>}
          </div>
          {!canEdit && <p className="sub">他のお店の記録です（見るだけ）。</p>}
          {people.map((a) => {
            const mine = rows.filter((r) => r.assistantId === a.id);
            return (
              <div key={a.id} className="card">
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}><b style={{ fontSize: 18 }}>{a.name}</b>{a.rank === "assistant" && <span className="chip">アシスタント</span>}</div>
                {mine.length > 0 && <div className="lessonchips">{mine.map((r) => (
                  <span key={r.id} className="lchip done">{r.category} <b>{r.ordinal}人目</b>{r.minutes ? ` ${r.minutes}分` : ""}{canEdit && <button aria-label="取り消す" onClick={() => del(r)}>×</button>}</span>))}</div>}
                {canEdit && <div className="lessonchips">{tops.filter((t) => !kidsOf(t.id).length).map((c) => (
                  <button key={c.id} className="lbtn" style={{ ["--h" as string]: hue(topIndex(c.id)) }} onClick={() => open(a, c)}>{c.name}</button>))}</div>}
                {canEdit && tops.filter((t) => kidsOf(t.id).length > 0).map((g) => (
                  <div key={g.id} className="lessongroup"><span className="gname" style={{ ["--h" as string]: hue(topIndex(g.id)) }}>{g.name}</span>
                    {kidsOf(g.id).map((c) => <button key={c.id} className="lbtn sm" style={{ ["--h" as string]: hue(topIndex(g.id)) }} onClick={() => open(a, c)}>{c.name}</button>)}</div>))}
              </div>
            );
          })}
          {meta && people.length === 0 && <p className="hint">対象の人がいません。スタッフの登録を確認してください。</p>}
          {meta && meta.assistants.some((x) => x.rank !== "assistant") && meta.assistants.some((x) => x.rank === "assistant") && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: 20 }} checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />アシスタント以外のスタッフも表示する</label>
          )}
        </>
      )}

      {tab === "report" && (
        <>
          <div className="toolbar" style={{ justifyContent: "center" }}>
            <button className="ghost" onClick={() => setYm(addMonth(ym, -1))} aria-label="前の月">‹</button><b style={{ fontSize: 20 }}>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b><button className="ghost" onClick={() => setYm(addMonth(ym, 1))} aria-label="次の月">›</button>
            <button className="ghost" onClick={async () => setOkMsg((await copyText(reportTsv())) ? "表をコピーしました（Excelやメールに貼れます）" : "コピーできませんでした")}>表をコピー</button>
            <button className="ghost" onClick={() => window.print()}>印刷</button>
          </div>
          {report.map((r) => (
            <div key={r.store.id}>
              <h2>{r.store.name}</h2>
              <div className="scroll card"><table className="sttable"><thead><tr><th>名前</th>{leafCats(r.meta.categories).map((c) => <th key={c.id} className="r">{labelIn(r.meta.categories, c)}</th>)}<th className="r">計</th></tr></thead>
                <tbody>{r.meta.assistants.filter((a) => r.rows.some((x) => x.assistantId === a.id)).map((a) => {
                  const mine = r.rows.filter((x) => x.assistantId === a.id);
                  return <tr key={a.id}><td>{a.name}</td>{leafCats(r.meta.categories).map((c) => { const n = mine.filter((x) => x.categoryId === c.id).length; return <td key={c.id} className="r">{n || "－"}</td>; })}<td className="r"><b>{mine.length}</b></td></tr>;
                })}</tbody></table>
                {r.rows.length === 0 && <p className="hint">この月の記録はまだありません。</p>}</div>
              {r.rows.length > 0 && <ul className="list">{r.rows.map((x) => (
                <li key={x.id}><div><b>{md(x.day)}　{x.assistantName}</b>　{x.category} <span className="chip">{x.ordinal}人目</span>{x.minutes ? <span className="chip">{x.minutes}分</span> : null}<div className="sub">{[x.note, x.byName && `記録: ${x.byName}`].filter(Boolean).join("　")}</div></div></li>))}</ul>}
            </div>
          ))}
        </>
      )}

      {sheet && (
        <div className="sheet-bg" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="レッスンを記録">
            <h3>{sheet.a.name} さん ／ {labelOf(sheet.c)}</h3>
            <p className="sub">{md(day)}（{WEEKDAYS[dow(day)]}）　これまで {meta?.counts[`${sheet.a.id}|${sheet.c.id}`] ?? 0} 回 → <b>今回で {(meta?.counts[`${sheet.a.id}|${sheet.c.id}`] ?? 0) + 1} 人目（回目）</b></p>
            <label>かかった時間（わかれば）</label>
            <div className="lessonchips">
              <button className={`lbtn ${minutes === null && !custom ? "sel" : ""}`} onClick={() => { setMinutes(null); setCustom(""); }}>入れない</button>
              {MIN_CHOICES.map((m) => <button key={m} className={`lbtn ${minutes === m && !custom ? "sel" : ""}`} onClick={() => { setMinutes(m); setCustom(""); }}>{m}分</button>)}
              <Stepper label="その他（分）" placeholder="その他（分）" unit="分" step={5} min={5} max={600} value={custom} onChange={setCustom} clearable />
            </div>
            <label>メモ（なくてもOK）<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 前髪が課題" /></label>
            {msg && <p className="err">{msg}</p>}
            <div className="toolbar"><button onClick={record}>記録する</button><button className="ghost" onClick={() => setSheet(null)}>やめる</button></div>
          </div>
        </div>
      )}

      {edit && (
        <div className="sheet-bg" onClick={() => setEdit(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ボタンを編集">
            <h3>ボタンを編集（このお店）</h3>
            <p className="sub">お店ごとに、ボタンを足したり、名前を変えたり、しまったりできます。しまっても、過去の記録は残ります。</p>
            {all.filter((c) => !c.parentId).map((c) => (
              <div key={c.id} style={{ borderTop: "1px solid var(--hair)", paddingTop: 6, marginTop: 6 }}>
                <CatRow c={c} cat={cat} />
                {all.filter((k) => k.parentId === c.id).map((k) => <div key={k.id} style={{ marginLeft: 22 }}><CatRow c={k} cat={cat} /></div>)}
                <div className="toolbar" style={{ marginLeft: 22, margin: "4px 0 0 22px" }}>
                  <input placeholder={`${c.name} の中に小さなボタンを足す`} style={{ flex: 1, fontSize: 14, padding: 10 }} value={subName[c.id] ?? ""} onChange={(e) => setSubName({ ...subName, [c.id]: e.target.value })} />
                  <button className="ghost" onClick={() => { if ((subName[c.id] ?? "").trim()) { cat({ name: subName[c.id], parentId: c.id }); setSubName({ ...subName, [c.id]: "" }); } }}>足す</button>
                </div>
              </div>
            ))}
            <div className="toolbar"><input placeholder="新しいボタン（例: ヘアセット）" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} /><button onClick={() => newName.trim() && cat({ name: newName })}>追加</button></div>
            {msg && <p className="err">{msg}</p>}
            <button className="ghost" onClick={() => { setEdit(false); load(); }}>閉じる</button>
          </div>
        </div>
      )}
    </main>
  );
}
export default function LessonsPage() { return <MeProvider><Page /></MeProvider>; }
