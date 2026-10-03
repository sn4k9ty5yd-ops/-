"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { summarize, type Share } from "@/lib/material-summary";
import { todayJst } from "@/lib/period-nav";
import type { StoreRow, SummaryLine, SummaryOrder } from "@/lib/service";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const mLabel = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

function Bars({ rows, title }: { rows: Share[]; title: string }) {
  return (
    <div className="card">
      <b>{title}</b>
      {rows.length === 0 && <p className="hint">まだありません。</p>}
      {rows.map((r) => (
        <div key={r.key} style={{ margin: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}><span>{r.label}</span><span><b>{r.pct}%</b>　{yen(r.amount)}</span></div>
          <div className="bar"><i style={{ width: `${Math.max(2, r.pct)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [year, setYear] = useState(Number(todayJst().slice(0, 4)));
  const [store, setStore] = useState("");           // 空=全店
  const [data, setData] = useState<{ orders: SummaryOrder[]; lines: SummaryLine[] } | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");

  useEffect(() => { api<StoreRow[]>("/api/stores").then(setStores).catch(() => {}); }, []);
  const load = useCallback(async () => {
    try { setData(await api(`/api/material/summary?from=${year}-01-01&to=${year}-12-31`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [year]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const name = useCallback((id: string) => stores.find((s) => s.id === id)?.name ?? "", [stores]);
  const sum = useMemo(() => {
    if (!data) return null;
    const orders = store ? data.orders.filter((o) => o.storeId === store) : data.orders;
    const ids = new Set(orders.map((o) => o.id));
    return summarize(orders, data.lines.filter((l) => ids.has(l.orderId)), name);
  }, [data, store, name]);

  if (!(me.level === 4 || me.materialManager)) return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>材料費統括</h1><p className="hint">この画面は、管理者と材料担当だけが見られます。</p></main>;
  const maxMonth = Math.max(1, ...(sum?.months.map((m) => m.total) ?? [0]));
  const tsv = () => !sum ? "" : ["月\t合計（税抜）\t前の月との増減%\t件数", ...sum.months.map((m) => [m.month, m.total, m.change ?? "", m.count].join("\t")), "", "商品\t数量\t金額（税抜）\t割合%", ...sum.byItem.map((i) => [i.name, i.qty, i.amount, i.pct].join("\t"))].join("\n");

  return (
    <main className="xwide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>材料費統括</h1>
      <p className="sub">全店の発注額（税抜）を、家計簿のように見ます。取り消した分は入っていません。</p>
      <div className="toolbar">
        <button className="ghost" onClick={() => { setYear(year - 1); setMonth(null); }} aria-label="前の年">‹</button>
        <b>{year}年</b>
        <button className="ghost" onClick={() => { setYear(year + 1); setMonth(null); }} aria-label="次の年">›</button>
        <select aria-label="お店" value={store} onChange={(e) => { setStore(e.target.value); setMonth(null); }}>
          <option value="">全店</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="ghost" onClick={async () => setNote((await copyText(tsv())) ? "表をコピーしました（Excelやメールに貼れます）" : "コピーできませんでした")}>表をコピー</button>
        <button className="ghost" onClick={() => window.print()}>印刷</button>
        <Link href="/material" className="storelink">発注を記録する画面へ</Link>
      </div>
      {msg && <p className="err">{msg}</p>}{note && <p className="sub">{note}</p>}

      {sum && (
        <>
          <div className="stats">
            <div className="card"><div className="sub">{year}年の材料費（税抜）</div><div className="big">{yen(sum.total)}</div></div>
            <div className="card"><div className="sub">1か月の平均</div><div className="big">{yen(sum.avgPerMonth)}</div></div>
            <div className="card"><div className="sub">発注の回数</div><div className="big">{sum.count}回</div></div>
          </div>

          <div className="card">
            <b>月ごとの材料費</b>
            {sum.months.length === 0 && <p className="hint">この年の記録はまだありません。</p>}
            {sum.months.map((m) => (
              <button key={m.month} className="monthrow" onClick={() => setMonth(month === m.month ? null : m.month)}>
                <span className="ml">{Number(m.month.slice(5))}月</span>
                <span className="bar" style={{ flex: 1 }}><i style={{ width: `${Math.max(2, (m.total / maxMonth) * 100)}%` }} /></span>
                <span className="mv"><b>{yen(m.total)}</b>{m.change !== null && <small style={{ color: m.change > 0 ? "#d70015" : "#1e8e3e" }}> 前の月より {m.change > 0 ? "+" : ""}{m.change}%</small>}</span>
              </button>
            ))}
            {month && sum.itemsByMonth[month] && (
              <div style={{ marginTop: 12 }}>
                <b>{mLabel(month)} に発注したもの</b>
                <table className="sttable"><thead><tr><th>商品・内容</th><th className="r">数量</th><th className="r">金額</th><th className="r">割合</th></tr></thead>
                  <tbody>{sum.itemsByMonth[month].map((i) => <tr key={i.name}><td>{i.name}</td><td className="r">{i.qty}</td><td className="r">{yen(i.amount)}</td><td className="r">{i.pct}%</td></tr>)}</tbody></table>
              </div>
            )}
            {!month && sum.months.length > 0 && <p className="hint">月を押すと、その月に何を発注したかが見られます。</p>}
          </div>

          <div className="grid2">
            <Bars rows={sum.byStore} title="お店ごとの割合" />
            <Bars rows={sum.byKind} title="種類ごとの割合" />
            <Bars rows={sum.bySupplier} title="発注先ごとの割合" />
          </div>

          <div className="card">
            <b>商品ごとの発注（多い順）</b>
            <div className="scroll"><table className="sttable"><thead><tr><th>商品・内容</th><th className="r">数量</th><th className="r">金額（税抜）</th><th className="r">割合</th><th className="r">回数</th></tr></thead>
              <tbody>{sum.byItem.slice(0, 50).map((i) => <tr key={i.name}><td>{i.name}</td><td className="r">{i.qty}</td><td className="r">{yen(i.amount)}</td><td className="r"><b>{i.pct}%</b></td><td className="r">{i.orders}</td></tr>)}</tbody></table></div>
            <p className="hint">明細を入れた発注は商品ごと、入れていない発注は「内容」の文字で数えています。</p>
          </div>
        </>
      )}
    </main>
  );
}
export default function SummaryPage() { return <MeProvider><Page /></MeProvider>; }
