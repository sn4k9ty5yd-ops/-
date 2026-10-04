"use client";
import { SubTabs } from "@/app/SubTabs";
import { salesTabs } from "@/lib/sales-tabs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { achievement, calcCommission, newRate, pct1, repeatRate, signed, unitPrice, yen, yoy } from "@/lib/sales-calc";
import { md } from "@/lib/labels";
import { todayJst } from "@/lib/period-nav";
import { EMPTY_SALES, SALES_STATUS_LABEL, type MySales, type SalesValues } from "@/lib/service";

const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };

/** 直近12か月の推移。棒＝今年、線＝前年の同じ月 */
function Trend({ series, end }: { series: MySales["series"]; end: string }) {
  const months = Array.from({ length: 12 }, (_, i) => addMonth(end, i - 11));
  const val = (m: string) => series.find((s) => s.month === m)?.total ?? 0;
  const max = Math.max(1, ...months.map(val), ...months.map((m) => val(addMonth(m, -12))));
  const W = 340, H = 150, bw = W / 12;
  const y = (v: number) => H - 20 - (v / max) * (H - 36);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="売上の推移">
      {months.map((m, i) => (
        <g key={m}>
          <rect x={i * bw + 5} y={y(val(m))} width={bw - 10} height={Math.max(2, H - 20 - y(val(m)))} rx="4" fill="url(#g1)" />
          <text x={i * bw + bw / 2} y={H - 5} fontSize="9" textAnchor="middle" fill="var(--sub)">{Number(m.slice(5))}</text>
        </g>
      ))}
      <polyline fill="none" stroke="#ff9f0a" strokeWidth="2" strokeDasharray="4 3" points={months.map((m, i) => `${i * bw + bw / 2},${y(val(addMonth(m, -12)))}`).join(" ")} />
      <defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0a84ff" /><stop offset="1" stopColor="#5e5ce6" /></linearGradient></defs>
    </svg>
  );
}

function Page() {
  const { me } = useMe();
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [d, setD] = useState<MySales | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { try { setD(await api<MySales>(`/api/sales?mine=1&month=${ym}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); } }, [ym]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const [form, setForm] = useState<SalesValues | null>(null);
  const [ok, setOk] = useState("");
  const EMPTY: SalesValues = EMPTY_SALES;
  const editable = !!d && (d.status === null || d.status === "draft" || d.status === "returned");
  const cur: SalesValues = form ?? (d?.mine ? { ...EMPTY_SALES, ...d.mine } : EMPTY);
  const daysLeft = d ? Math.round((new Date(d.dueOn + "T00:00:00Z").getTime() - new Date(todayJst() + "T00:00:00Z").getTime()) / 86400000) : 0;
  const num = (raw: string) => Number(raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "") || "0");
  const saveForm = async (andSubmit: boolean) => {
    try {
      await api("/api/sales", { action: "save-own", month: ym, values: cur, storeId: me.storeId });
      if (andSubmit) await api("/api/sales", { action: "submit", month: ym, storeId: me.storeId });
      setForm(null); setOk(andSubmit ? "提出しました。店長が確認します" : "保存しました（まだ提出していません）"); setMsg(""); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const total = d?.mine?.total ?? 0;
  const y = yoy(total, d?.prev?.total);
  const ach = achievement(total, d?.target ?? null);
  const share = pct1(total, d?.store.total ?? 0);
  const myRank = d?.board.find((b) => b.membershipId === me.id);

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>売上</h1>
      <SubTabs items={salesTabs(me.level, me.displayOnly)} />
      <div className="toolbar" style={{ justifyContent: "center" }}>
        <button className="ghost" onClick={() => setYm(addMonth(ym, -1))} aria-label="前の月">‹</button><b style={{ fontSize: 22 }}>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b><button className="ghost" onClick={() => setYm(addMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      {msg && <p className="err">{msg}</p>}
      {ok && <p className="sub" style={{ color: "var(--ok)" }}>✅ {ok}</p>}
      {d && (
        <div className="card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}><b style={{ fontSize: 18 }}>{Number(ym.slice(5))}月の売上を提出する</b>
            <span className="chip" style={{ color: d.status === "office_ok" ? "var(--ok)" : d.status === "returned" ? "var(--bad)" : undefined }}>{d.status ? SALES_STATUS_LABEL[d.status] : "まだ入れていません"}</span></div>
          <p className="sub" style={{ margin: "6px 0 10px" }}>流れ：<b>自分で記入して提出 → 店長が確認 → 事務員さんが確定</b></p>
          {d.status === "returned" && <p className="err">差し戻されました{d.returnComment ? `：「${d.returnComment}」` : ""}。直して、もう一度提出してください。</p>}
          <p className="sub" style={{ margin: "0 0 6px" }}>提出期限：<b>{md(d.dueOn)}</b>　{editable && (daysLeft < 0 ? <span className="chip" style={{ color: "var(--bad)" }}>期限を過ぎています</span> : daysLeft <= 3 ? <span className="chip warn">あと{daysLeft}日</span> : <span className="chip">あと{daysLeft}日</span>)}</p>
          {([
            ["全体", [["total", "総合売上（円）"], ["free", "フリー売上（円）"], ["nominated", "指名技術売上（円）"], ["customers", "客数（人）"], ["newCustomers", "新規（人）"], ["repeatCustomers", "再来（人）"]]],
            [`店販（歩合 ${d.rates.retail}%）`, [["retail", "店販売上（円）"], ["retailCount", "店販の人数（人）"]]],
            [`着付け（歩合 ${d.rates.kitsuke}%）`, [["kitsukeCount", "着付けの人数（人）"], ["kitsukeSales", "着付けの売上（円）"]]],
            [`メイク（歩合 ${d.rates.makeup}%）`, [["makeupCount", "メイクの人数（人）"], ["makeupSales", "メイクの売上（円）"]]],
            [`ヘッドスパ（歩合 ${d.rates.spa}%）`, [["spaCount", "ヘッドスパの人数（人）"], ["spaSales", "ヘッドスパの売上（円）"]]],
          ] as [string, [keyof SalesValues, string][]][]).map(([title, fields]) => (
            <div key={title}>
              <b className="formsec">{title}</b>
              <div className="salesform">{fields.map(([k, l]) => (
                <label key={k}>{l}<input inputMode="numeric" disabled={!editable} value={cur[k] === 0 ? "" : String(cur[k])} placeholder="0" onChange={(e) => setForm({ ...cur, [k]: num(e.target.value) })} /></label>
              ))}</div>
            </div>
          ))}
          <p className="sub">客単価 <b>{unitPrice(cur.total, cur.customers) === null ? "－" : yen(unitPrice(cur.total, cur.customers) as number)}</b>　新規の割合 <b>{newRate(cur.newCustomers, cur.repeatCustomers) ?? "－"}{newRate(cur.newCustomers, cur.repeatCustomers) === null ? "" : "%"}</b>（自動で計算されます）</p>
          {editable && <div className="toolbar"><button onClick={() => saveForm(true)} disabled={cur.total === 0}>提出する</button><button className="ghost" onClick={() => saveForm(false)}>保存だけ</button>{form && <button className="ghost" onClick={() => setForm(null)}>やめる</button>}</div>}
          {!editable && <p className="hint">提出したあとは、直せません。直したいときは、店長に「差し戻し」をお願いしてください。</p>}
        </div>
      )}
      {d && (() => { const c = calcCommission({ retail: cur.retail, kitsukeSales: cur.kitsukeSales, makeupSales: cur.makeupSales, spaSales: cur.spaSales }, d.rates); return c.total > 0 || d.commission !== null ? (
        <div className="card"><b>歩合</b>
          {d.commission !== null ? <p style={{ margin: "6px 0" }}>確定した歩合：<b style={{ fontSize: 24 }}>{yen(d.commission)}</b><span className="sub">　（店長・シフト担当がつけました）</span></p>
            : <p className="sub" style={{ margin: "6px 0" }}>まだ、つけられていません。下は、入れた数字からの目安です。</p>}
          <table className="sttable"><tbody>{c.items.filter((i) => i.sales > 0).map((i) => <tr key={i.key}><td>{i.label}</td><td className="r">{yen(i.sales)}</td><td className="r">{i.rate}%</td><td className="r"><b>{yen(i.amount)}</b></td></tr>)}
            <tr className="sumrow"><td colSpan={3}>目安の合計</td><td className="r"><b>{yen(c.total)}</b></td></tr></tbody></table></div>) : null; })()}
      {d && !d.mine && <p className="hint">この月の売上は、まだ入っていません。</p>}
      {d?.mine && d.status && d.status !== "draft" && d.status !== "returned" && (
        <>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="sub">総合売上</div><div className="big" style={{ fontSize: 40 }}>{yen(total)}</div>
            {y !== null && <p style={{ margin: "6px 0 0" }}>前年の同じ月 {yen(d.prev?.total ?? 0)} →　<b style={{ color: y >= 0 ? "var(--ok)" : "var(--bad)" }}>{signed(y)}</b>　{y > 0 ? "🎉 前年を超えました！" : y < 0 ? "前年まであと " + yen((d.prev?.total ?? 0) - total) : "前年と同じです"}</p>}
          </div>
          <div className="stats stats3">
            <div className="card"><div className="sub">客数</div><div className="big">{d.mine.customers}人</div></div>
            <div className="card"><div className="sub">客単価</div><div className="big">{unitPrice(total, d.mine.customers) === null ? "－" : yen(unitPrice(total, d.mine.customers) as number)}</div></div>
            <div className="card"><div className="sub">店販売上</div><div className="big">{yen(d.mine.retail)}</div></div>
          </div>
          <div className="grid2">
            <div className="card"><b>内わけ</b>
              <p className="sub" style={{ margin: "6px 0" }}>フリー {yen(d.mine.free)}　／　指名技術 {yen(d.mine.nominated)}</p>
              <p className="sub" style={{ margin: "6px 0" }}>新規 {d.mine.newCustomers}人（{newRate(d.mine.newCustomers, d.mine.repeatCustomers) ?? "－"}%）／ 再来 {d.mine.repeatCustomers}人（{repeatRate(d.mine.newCustomers, d.mine.repeatCustomers) ?? "－"}%）</p></div>
            <div className="card" hidden={me.level < 2}><b>お店の中で</b>
              <p style={{ margin: "6px 0" }}>お店の売上 {yen(d.store.total)} のうち、あなたは <b style={{ fontSize: 22 }}>{share ?? "－"}%</b></p>
              {myRank && <p style={{ margin: 0 }}>店内 <b style={{ fontSize: 22 }}>{myRank.rank}位</b> / {d.board.length}人</p>}</div>
          </div>
          {d.target !== null && (
            <div className="card"><b>あなたの目標 {yen(d.target)}</b><div className="bar"><i style={{ width: `${Math.min(100, ach ?? 0)}%` }} /></div><b>達成率 {ach ?? 0}%</b><span className="sub">　あと {yen(Math.max(0, d.target - total))}</span></div>
          )}
        </>
      )}
      {d?.storeTarget != null && (
        <div className="card"><b>お店の目標 {yen(d.storeTarget)}</b><div className="bar"><i style={{ width: `${Math.min(100, achievement(d.store.total, d.storeTarget) ?? 0)}%` }} /></div><b>達成率 {achievement(d.store.total, d.storeTarget) ?? 0}%</b><span className="sub">　お店の売上 {yen(d.store.total)}</span></div>
      )}
      {d && d.board.length > 0 && (
        <div className="card"><b>店内ランキング（総合売上）</b>
          <ol className="board">{d.board.map((b) => <li key={b.membershipId} className={b.membershipId === me.id ? "me" : ""}><span className="rk">{b.rank}</span><span style={{ flex: 1 }}>{b.name}</span><b>{yen(b.total)}</b></li>)}</ol></div>
      )}
      {d && <div className="card"><b>この1年の推移</b><p className="sub" style={{ margin: "2px 0 8px" }}>青い棒＝今年　オレンジの点線＝前の年の同じ月</p><Trend series={d.series} end={ym} /></div>}
    </main>
  );
}
function Gate() {
  const { me } = useMe();
  return <Page />;
}
export default function MySalesPage() { return <MeProvider><Gate /></MeProvider>; }
