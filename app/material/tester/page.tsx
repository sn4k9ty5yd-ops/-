"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { materialTabs } from "@/lib/material-tabs";
import { todayJst } from "@/lib/period-nav";
import type { ProductRow, StoreRow, TesterRow } from "@/lib/service";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const toInt = (raw: string) => raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [data, setData] = useState<{ rows: TesterRow[]; total: number } | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pq, setPq] = useState("");
  const [pick, setPick] = useState<ProductRow | null>(null);
  const [qty, setQty] = useState("1");
  const [day, setDay] = useState(todayJst());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");

  useEffect(() => { if (me.level === 4) api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, [me.level]);
  useEffect(() => { api<ProductRow[]>("/api/products?kind=retail").then((p) => setProducts(p.filter((x) => x.status === "active"))).catch(() => setProducts([])); }, []);
  const load = useCallback(async () => {
    try { setData(await api<{ rows: TesterRow[]; total: number }>(`/api/tester?storeId=${storeId}&month=${ym}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [storeId, ym]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const found = useMemo(() => pq.trim() ? products.filter((p) => p.storeIds.includes(storeId) && `${p.maker}${p.name}${p.spec}`.toLowerCase().includes(pq.trim().toLowerCase())).slice(0, 20) : [], [products, pq, storeId]);
  const n = Number(qty || 0);
  const add = async () => {
    if (!pick) return;
    try { await api("/api/tester", { action: "add", storeId, productId: pick.id, qty: n, day, note }); setPick(null); setPq(""); setQty("1"); setNote(""); setOk("記録しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const cancel = async (r: TesterRow) => {
    if (!confirm(`${r.name} ${r.qty}本の記録を取り消しますか？（在庫も元にもどります）`)) return;
    try { await api("/api/tester", { action: "cancel", id: r.id }); setOk("取り消しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const tsv = () => ["日付\tメーカー\t商品\t規格\t本数\t仕入値（税抜）\t金額（税抜）\tメモ", ...(data?.rows ?? []).slice().reverse().map((r) => [r.day, r.maker, r.name, r.spec, r.qty, r.unitCost, r.amount, r.note ?? ""].join("\t")), `合計\t\t\t\t\t\t${data?.total ?? 0}\t`].join("\n");
  const own = me.level === 4 || storeId === me.storeId;

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>材料費</h1>
      <SubTabs items={materialTabs(me.displayOnly)} />
      <p className="sub">店販として仕入れた商品を、お客様のテスターなど、サロンワークで使った分を記録します（事務所への報告用）。金額は、商品の仕入値×本数で自動で出ます。</p>
      <div className="toolbar">
        {me.level === 4 && <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <button className="ghost" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="前の月">‹</button>
        <b>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
        <button className="ghost" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub">{ok}</p>}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="sub">この月に業務に回した金額（仕入値・税抜）</div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{yen(data?.total ?? 0)}</div>
      </div>

      {own && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>テスターに使った商品を記録する</b>
          {!pick ? (
            <>
              <input aria-label="商品をさがす" placeholder="メーカー・品名でさがす（例：髪にドラマを。）" value={pq} onChange={(e) => setPq(e.target.value)} />
              <div className="actions" style={{ flexWrap: "wrap" }}>
                {found.map((p) => <button key={p.id} className="ghost" style={{ width: "auto", color: "var(--ink)", border: "1px solid var(--line, #ddd)", borderRadius: 20 }} onClick={() => setPick(p)}>{p.name}{p.spec ? `（${p.spec}）` : ""} {yen(p.costPrice)}</button>)}
                {pq.trim() && found.length === 0 && <span className="sub">見つかりません。商品は「材料費」の発注の画面から登録できます（店長・事務員さん）。</span>}
              </div>
            </>
          ) : (
            <>
              <p><b>{pick.maker} {pick.name}</b>{pick.spec ? `（${pick.spec}）` : ""}　仕入値 {yen(pick.costPrice)}　<button className="ghost" onClick={() => setPick(null)}>えらびなおす</button></p>
              <div className="toolbar">
                <label>本数<input inputMode="numeric" style={{ width: 80 }} value={qty} onChange={(e) => setQty(toInt(e.target.value))} /></label>
                <label>日付<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
              </div>
              <input placeholder="メモ（任意）" value={note} onChange={(e) => setNote(e.target.value)} />
              <p>合計 <b style={{ fontSize: 22 }}>{yen(pick.costPrice * n)}</b></p>
              <button disabled={n < 1} onClick={add}>記録する</button>
            </>
          )}
        </div>
      )}

      <div className="toolbar"><button className="ghost" onClick={async () => { setOk((await copyText(tsv())) ? "表をコピーしました（エクセル・メールに貼れます）" : "コピーできませんでした"); }}>表をコピー</button><button className="ghost" onClick={() => window.print()}>印刷</button></div>
      {data && data.rows.length === 0 && <p className="hint">この月の記録はまだありません。</p>}
      <ul className="list">
        {(data?.rows ?? []).map((r) => (
          <li key={r.id} style={{ display: "block" }}>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <div><b>{md(r.day)}　{r.name}</b>{r.spec ? `（${r.spec}）` : ""}　{r.qty}本　<span className="sub">{yen(r.unitCost)}×{r.qty}</span><br /><span className="sub">{r.byName ?? ""}{r.note ? `　${r.note}` : ""}{r.stockApplied ? "　在庫も減らしました" : ""}</span></div>
              <div style={{ textAlign: "right" }}><b>{yen(r.amount)}</b>{own && (me.level >= 3 || r.createdBy === me.id) && <div><button className="ghost" onClick={() => cancel(r)}>取り消す</button></div>}</div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
export default function TesterPage() { return <MeProvider><Page /></MeProvider>; }
