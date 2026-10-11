"use client";
import { SubTabs } from "@/app/SubTabs";
import { shiftTabs } from "@/lib/shift-tabs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { holidayName } from "@/lib/holidays";
import { daysOf, dow, KIND_LABEL, md, WEEKDAYS } from "@/lib/labels";
import { PeriodNav, periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { STATUS_LABEL, type PeriodRow, type RequestRow } from "@/lib/service";
import { nameColor } from "@/lib/rank-color";

type Lm = { maxOff: number; maxStylist: number | null; maxAssistant: number | null; maxAssistant1: number | null; maxAssistant2: number | null };
type Who = { id: string; rank?: string | null; assistantYear?: number | null };

function Page() {
  const { me } = useMe();
  const [all, setAll] = useState<PeriodRow[] | null>(null);
  const [view, setView] = useState<Period | null>(null);
  const [mine, setMine] = useState<Map<string, string>>(new Map());
  const [cnt, setCnt] = useState<Map<string, number>>(new Map());
  const [lim, setLim] = useState<Map<string, Lm>>(new Map());
  const [who, setWho] = useState<Who[]>([]);
  const [reqs, setReqs] = useState<{ membershipId: string; storeId: string; day: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PeriodRow[]>("/api/periods").then((ps) => {
      setAll(ps);
      // まず「いま受付中の期間」、なければ「今回の期間」を表示
      const open = ps.find((p) => p.stores.some((s) => s.storeId === me.storeId && s.status === "collecting"));
      setView(open ? { start: open.start, end: open.end, label: open.label } : periodFor(todayJst(), me.closingStartDay));
    });
  }, [me.storeId, me.closingStartDay]);

  const db = all?.find((p) => p.start === view?.start);
  const load = useCallback(async () => {
    if (!db) { setMine(new Map()); setCnt(new Map()); setLim(new Map()); return; }
    const rs = await api<RequestRow[]>(`/api/requests?periodId=${db.id}`);
    setMine(new Map(rs.filter((r) => r.membershipId === me.id).map((r) => [r.day, r.kind])));
    const c = new Map<string, number>();
    for (const r of rs) if (r.storeId === me.storeId) c.set(r.day, (c.get(r.day) ?? 0) + 1);
    setCnt(c); setReqs(rs);
    setWho(await api<Who[]>(`/api/roster?storeId=${me.storeId}`).catch(() => [] as Who[]));
    const dl = await api<{ limits: (Lm & { day: string })[] }>(`/api/day-limits?periodId=${db.id}&storeId=${me.storeId}`).catch(() => null);
    setLim(new Map((dl?.limits ?? []).map((l) => [l.day, l])));
  }, [db, me.id, me.storeId]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  if (me.displayOnly) return <main><Link href="/shifts" className="back">← シフト</Link><h1>希望休</h1><p className="hint">このアカウントは、見るだけです。希望休は出せません。</p></main>;
  if (!view || !all) return null;
  const st = db?.stores.find((s) => s.storeId === me.storeId);
  const open = !!db && st?.status === "collecting" && (!st.closeAt || new Date(st.closeAt) > new Date());
  const days = daysOf(view.start, view.end);
  const lead = dow(days[0]);
  // 自分の仲間（スタイリスト／アシスタント1年目／2年目）の「上限・いま出ている人数・あと何人」を、日ごとに出す
  const meW = who.find((w) => w.id === me.id);
  const grp = meW?.rank === "stylist" ? "stylist" : meW?.rank === "assistant" ? (meW.assistantYear === 1 ? "a1" : meW.assistantYear === 2 ? "a2" : "assistant") : null;
  const grpName = grp === "stylist" ? "スタイリスト" : grp === "a1" ? "アシスタント1年目" : grp === "a2" ? "アシスタント2年目" : grp === "assistant" ? "アシスタント" : "";
  const inGrp = (w: Who | undefined) => !!w && (grp === "stylist" ? w.rank === "stylist" : grp === "a1" ? w.rank === "assistant" && w.assistantYear === 1 : grp === "a2" ? w.rank === "assistant" && w.assistantYear === 2 : grp === "assistant" ? w.rank === "assistant" : false);
  const room = (d: string): { max: number; n: number; left: number } | null => {
    const l = lim.get(d); if (!l || !grp) return null;
    const max = grp === "stylist" ? l.maxStylist : grp === "a1" ? (l.maxAssistant1 ?? l.maxAssistant) : grp === "a2" ? (l.maxAssistant2 ?? l.maxAssistant) : l.maxAssistant;
    if (max === null || max === undefined) return null;
    // 年別の上限がないとき（全体だけの日）は、アシスタント全員の人数で数える
    const yearLimit = (grp === "a1" && l.maxAssistant1 !== null) || (grp === "a2" && l.maxAssistant2 !== null);
    const n = reqs.filter((r) => r.day === d && r.storeId === me.storeId && (yearLimit || grp === "stylist" ? inGrp(who.find((w) => w.id === r.membershipId)) : who.find((w) => w.id === r.membershipId)?.rank === "assistant")).length;
    return { max, n, left: max - n };
  };

  return (
    <main>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>シフト</h1>
      <SubTabs items={shiftTabs(me.level)} />
      <SubTabs items={[{ href: "/requests", label: "希望休" }, { href: "/leave", label: "有給申請" }]} />
      <p className="hint">ここは「出す」画面です。休みたい日を、カレンダーで出します。</p>
      <PeriodNav period={view} startDay={me.closingStartDay} onChange={setView} />
      <div className="tintbox" style={tintStyle(view.start)}>
        <p className="sub" style={{ margin: "4px 4px 10px" }}>
          {!db ? "この期間は、まだ作成されていません。" : open
            ? `${STATUS_LABEL[st!.status]}。休みたい日をタップして、公休か有給かを選んでください。`
            : `いまは受付していません（${st ? STATUS_LABEL[st.status] : ""}）。`}
        </p>
        <div className="cal2">
          {WEEKDAYS.map((w, i) => <div key={w} className={`h ${i === 0 ? "su" : i === 6 ? "sa" : ""}`}>{w}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
          {days.map((d) => {
            const kind = mine.get(d);
            const n = cnt.get(d) ?? 0, m = lim.get(d)?.maxOff;
            const rm = room(d); const bg = rm && open && !kind ? (rm.left <= 0 ? "rgba(215,0,21,.10)" : rm.left === 1 ? "rgba(255,159,10,.14)" : "rgba(18,161,80,.12)") : undefined;
            return (
              <button key={d} disabled={!open && !kind} className={`d ${kind ? "on" : ""} ${holidayName(d) ? "hol" : ""}`} style={{ background: bg }}
                onClick={() => { setMsg(""); setPick(d); }}>
                <span>{md(d)}</span>{holidayName(d) && <small className="holname">{holidayName(d)}</small>}{kind && <small>{KIND_LABEL[kind]}</small>}
                {rm ? <small style={{ display: "block", fontSize: 10, fontWeight: 800, color: rm.left < 0 ? "#d70015" : rm.left === 0 ? "#d70015" : rm.left === 1 ? "#c77700" : "#12a150" }}>{rm.left < 0 ? `超${-rm.left}` : rm.left === 0 ? "満員" : `あと${rm.left}人`}</small>
                  : (m !== undefined || n > 0) && <small style={{ display: "block", fontSize: 10, color: m !== undefined && n > m ? "#d70015" : "var(--sub)", fontWeight: m !== undefined && n > m ? 800 : 400 }}>{n}人{m !== undefined ? `/${m}` : ""}</small>}
              </button>
            );
          })}
        </div>
      </div>
      {grp && <p className="hint"><b style={{ color: nameColor(meW?.rank, meW?.assistantYear) }}>あなた（{grpName}）</b>が休める人数の目安に対して、<b style={{ color: "#12a150" }}>あと◯人</b>（余裕あり・緑）、<b style={{ color: "#c77700" }}>あと1人</b>（オレンジ）、<b style={{ color: "#d70015" }}>満員</b>（赤）が日付の下に出ます。「どこでもいい」ときは、緑の日を選ぶと、目安の中でおさまります。</p>}
      <p className="hint">{grp ? "" : "日付の下の数字は「休みを出している人／休める人数の目安」です。"}目安をこえても、希望休は出せます（あとで店長・シフト担当が調整します）。みんなの休みは、<Link href="/shifts" style={{ color: "var(--blue)" }}>「見る」</Link>のカレンダーで見られます（見るだけ）。</p>
      <p className="hint">この期間に出した希望休：{mine.size}日（公休 {[...mine.values()].filter((k) => k !== "paid").length}日・有給 {[...mine.values()].filter((k) => k === "paid").length}日）</p>
      {pick && (
        <div className="sheet-bg" onClick={() => setPick(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="公休か有給か選ぶ">
            <b style={{ fontSize: 18 }}>{md(pick)}（{WEEKDAYS[dow(pick)]}）</b>
            <div className="sub">{mine.has(pick) ? `いまは「${KIND_LABEL[mine.get(pick)!]}」で出しています。` : "この日を、どちらで出しますか？"}</div>
            {(() => { const r = room(pick); return r ? <p style={{ margin: "6px 0", fontWeight: 700, color: r.left <= 0 ? "#d70015" : r.left === 1 ? "#c77700" : "#12a150" }}>{grpName}の目安：{r.max}人まで／いま{r.n}人が希望休 → {r.left < 0 ? `${-r.left}人こえています` : r.left === 0 ? "満員です（ほかの日もさがしてみましょう）" : `あと${r.left}人`}</p> : null; })()}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {([["hope", "公休で出す"], ["paid", "有給で出す"]] as const).map(([k, label]) => (
              <button key={k} disabled={busy || !open} className={mine.get(pick) === k ? "" : "ghost"} style={mine.get(pick) === k ? undefined : { color: "var(--ink)", border: "1px solid var(--line)" }}
                onClick={async () => { setBusy(true); try { await api("/api/requests", { periodId: db!.id, day: pick, kind: k }); setMsg(""); await load(); setPick(null); } catch (e) { setMsg((e as Error).message); setPick(null); } finally { setBusy(false); } }}>
                {label}{mine.get(pick) === k ? "（いまの）" : ""}
              </button>
            ))}
            {mine.has(pick) && (
              <button className="ghost" disabled={busy || !open} onClick={async () => { setBusy(true); try { await api("/api/requests", { periodId: db!.id, day: pick, kind: null }); setMsg(""); await load(); setPick(null); } catch (e) { setMsg((e as Error).message); setPick(null); } finally { setBusy(false); } }}>この日の希望を取り消す</button>
            )}
            <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => setPick(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
    </main>
  );
}
export default function RequestsPage() { return <MeProvider><Page /></MeProvider>; }
