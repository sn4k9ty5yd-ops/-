"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { achievement, newRate, pct1, repeatRate, signed, unitPrice, yen, yoy } from "@/lib/sales-calc";
import { todayJst } from "@/lib/period-nav";
import type { MySales } from "@/lib/service";

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

  const total = d?.mine?.total ?? 0;
  const y = yoy(total, d?.prev?.total);
  const ach = achievement(total, d?.target ?? null);
  const share = pct1(total, d?.store.total ?? 0);
  const myRank = d?.board.find((b) => b.membershipId === me.id);

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>自分の売上</h1>
      <div className="toolbar" style={{ justifyContent: "center" }}>
        <button className="ghost" onClick={() => setYm(addMonth(ym, -1))} aria-label="前の月">‹</button><b style={{ fontSize: 22 }}>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b><button className="ghost" onClick={() => setYm(addMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      {msg && <p className="err">{msg}</p>}
      {d && !d.mine && <p className="hint">この月の売上は、まだ入っていません。月末に、店長が入れます。</p>}
      {d?.mine && (
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
            <div className="card"><b>お店の中で</b>
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
export default function MySalesPage() { return <MeProvider><Page /></MeProvider>; }
