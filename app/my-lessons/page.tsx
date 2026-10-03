"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { dow, md, WEEKDAYS } from "@/lib/labels";
import { statsFor, trend } from "@/lib/lesson-summary";
import { todayJst } from "@/lib/period-nav";
import type { LessonRow } from "@/lib/service";

const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const daysIn = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const hueOf = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

function Page() {
  const { me } = useMe();
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [all, setAll] = useState<LessonRow[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setAll(await api<LessonRow[]>(`/api/lessons?assistantId=${me.id}&from=2000-01-01&to=2099-12-31`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [me.id]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const byDay = useMemo(() => { const m = new Map<string, LessonRow[]>(); for (const r of all) m.set(r.day, [...(m.get(r.day) ?? []), r]); return m; }, [all]);
  const stats = useMemo(() => statsFor(all, ym), [all, ym]);
  const monthRows = all.filter((r) => r.day.startsWith(ym));
  const lead = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
  const today = todayJst();

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>自分のレッスン</h1>
      <p className="sub">教育担当が記録した、あなたのレッスンです。カレンダーの印は「ボタンの最初の2文字＋何人目（何回目）」です。日にちを押すと、くわしく見られます。</p>
      {msg && <p className="err">{msg}</p>}
      <div className="toolbar" style={{ justifyContent: "center" }}>
        <button className="ghost" onClick={() => { setYm(addMonth(ym, -1)); setPick(null); }} aria-label="前の月">‹</button>
        <b style={{ fontSize: 22 }}>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
        <button className="ghost" onClick={() => { setYm(addMonth(ym, 1)); setPick(null); }} aria-label="次の月">›</button>
        <span className="chip">今月 {monthRows.length}回</span>
      </div>

      <div className="mcal">
        {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysIn(ym) }, (_, i) => {
          const d = `${ym}-${String(i + 1).padStart(2, "0")}`; const list = byDay.get(d) ?? [];
          return (
            <div key={d} role="button" tabIndex={0} onClick={() => list.length && setPick(pick === d ? null : d)}
              className={`mday ${d === today ? "today" : ""} ${holidayName(d) ? "hol" : ""} ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}`} style={{ cursor: list.length ? "pointer" : "default" }}>
              <div className="num"><span>{i + 1}</span></div>
              {list.slice(0, 4).map((r) => <div key={r.id} className="lcal" style={{ ["--h" as string]: hueOf(r.category) }}>{r.category.slice(0, 2)}{r.ordinal}</div>)}
              {list.length > 4 && <div className="sub">ほか{list.length - 4}</div>}
            </div>
          );
        })}
      </div>

      {pick && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>{md(pick)}（{WEEKDAYS[dow(pick)]}）にしたこと</b>
          {(byDay.get(pick) ?? []).map((r) => (
            <div key={r.id} style={{ margin: "8px 0" }}><span className="lcal big" style={{ ["--h" as string]: hueOf(r.category) }}>{r.category}</span> <b>{r.ordinal}人目（回目）</b>{r.minutes ? `　${r.minutes}分` : ""}{r.note ? <span className="sub">　{r.note}</span> : null}</div>
          ))}
        </div>
      )}

      <h2>カテゴリごとのまとめ</h2>
      {stats.length === 0 && <p className="hint">まだ記録がありません。教育担当が記録すると、ここに出ます。</p>}
      <div className="grid2">
        {stats.map((s) => {
          const t = trend(s);
          return (
            <div key={s.category} className="card">
              <span className="lcal big" style={{ ["--h" as string]: hueOf(s.category) }}>{s.category}</span>
              <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)", margin: "10px 0 0" }}>
                <div><div className="sub">これまで</div><b style={{ fontSize: 22 }}>{s.total}</b>回</div>
                <div><div className="sub">今月</div><b style={{ fontSize: 22 }}>{s.month}</b>回</div>
                <div><div className="sub">平均</div><b style={{ fontSize: 22 }}>{s.avgMin ?? "－"}</b>{s.avgMin !== null && "分"}</div>
              </div>
              {s.recentAvg !== null && <p className="sub" style={{ margin: "8px 0 0" }}>最近5回の平均 <b>{s.recentAvg}分</b>
                {t === "slower" && <span style={{ color: "var(--bad)" }}>　↑ 以前より時間がかかっています</span>}
                {t === "faster" && <span style={{ color: "var(--ok)" }}>　↓ 以前より早くなっています</span>}</p>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
export default function MyLessonsPage() { return <MeProvider><Page /></MeProvider>; }
