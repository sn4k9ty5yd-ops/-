"use client";
import Link from "next/link";
import { Stepper } from "@/app/Stepper";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { materialTabs } from "@/lib/material-tabs";
import { todayJst } from "@/lib/period-nav";
import type { ProductRow, PurchaseRow, StoreRow } from "@/lib/service";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const toInt = (raw: string) => raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
interface Person { id: string; name: string; storeId: string }

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [data, setData] = useState<{ rows: PurchaseRow[]; total: number; byPerson: { membershipId: string; name: string; total: number; count: number }[] } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [buyer, setBuyer] = useState(me.id);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pq, setPq] = useState("");
  const [pick, setPick] = useState<ProductRow | null>(null);
  const [qty, setQty] = useState("1");
  const [day, setDay] = useState(todayJst());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const boss = me.level >= 3;

  useEffect(() => { if (me.level === 4) api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, [me.level]);
  useEffect(() => { if (boss) api<{ id: string; name: string; storeId: string; status: string; displayOnly?: boolean }[]>("/api/staff").then((r) => setPeople(r.filter((x) => x.status === "active" && !x.displayOnly))).catch(() => {}); }, [boss]);
  useEffect(() => { api<ProductRow[]>("/api/products?kind=retail").then((p) => setProducts(p.filter((x) => x.status === "active"))).catch(() => setProducts([])); }, []);
  const load = useCallback(async () => {
    try { setData(await api(`/api/staff-buy?storeId=${storeId}&month=${ym}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [storeId, ym]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const storePeople = people.filter((x) => x.storeId === storeId);
  const found = useMemo(() => pq.trim() ? products.filter((p) => `${p.maker}${p.name}${p.spec}`.toLowerCase().includes(pq.trim().toLowerCase())).slice(0, 20) : [], [products, pq]);
  const n = Number(qty || 0);
  const buyerId = boss && buyer !== me.id && storePeople.some((x) => x.id === buyer) ? buyer : me.id;
  const own = me.level === 4 || storeId === me.storeId;
  const add = async () => {
    if (!pick) return;
    try { await api("/api/staff-buy", { action: "add", membershipId: buyerId, productId: pick.id, qty: n, day, note }); setPick(null); setPq(""); setQty("1"); setNote(""); setOk("記録しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const cancel = async (r: PurchaseRow) => {
    if (!confirm(`${r.buyer}さんの ${r.name} ${r.qty}本の記録を取り消しますか？`)) return;
    try { await api("/api/staff-buy", { action: "cancel", id: r.id }); setOk("取り消しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const tsv = () => ["日付\t名前\tメーカー\t商品\t規格\t本数\t価格（仕入値）\t金額\tメモ", ...(data?.rows ?? []).slice().reverse().map((r) => [r.day, r.buyer, r.maker, r.name, r.spec, r.qty, r.unitPrice, r.amount, r.note ?? ""].join("\t")),
    "", "名前\t本数\t給料から引く金額", ...(data?.byPerson ?? []).map((p) => [p.name, p.count, p.total].join("\t")), `合計\t\t${data?.total ?? 0}`].join("\n");

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>材料費</h1>
      <SubTabs items={materialTabs(me.displayOnly)} />
      <p className="sub">スタッフが個人で買った店販商品の記録です。価格は仕入値（売値の半分）で、給料から引く金額になります。見られるのは、自分の分だけです（店長は自分のお店、正美さんは全店）。</p>
      <div className="toolbar">
        {me.level === 4 && <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <button className="ghost" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="前の月">‹</button>
        <b>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
        <button className="ghost" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub">{ok}</p>}

      {own && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>買った商品を記録する</b>
          {boss && storePeople.length > 0 && (
            <label>買った人<select value={buyerId} onChange={(e) => setBuyer(e.target.value)}>{storePeople.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === me.id ? "（自分）" : ""}</option>)}</select></label>
          )}
          {!pick ? (
            <>
              <input aria-label="商品をさがす" placeholder="メーカー・品名でさがす（例：髪にドラマを。）" value={pq} onChange={(e) => setPq(e.target.value)} />
              <div className="actions" style={{ flexWrap: "wrap" }}>
                {found.map((p) => <button key={p.id} className="ghost" style={{ width: "auto", color: "var(--ink)", border: "1px solid var(--line, #ddd)", borderRadius: 20 }} onClick={() => setPick(p)}>{p.name}{p.spec ? `（${p.spec}）` : ""} {yen(p.costPrice)}</button>)}
                {pq.trim() && found.length === 0 && <span className="sub">見つかりません。</span>}
              </div>
            </>
          ) : (
            <>
              <p><b>{pick.maker} {pick.name}</b>{pick.spec ? `（${pick.spec}）` : ""}　スタッフ価格 {yen(pick.costPrice)}　<button className="ghost" onClick={() => setPick(null)}>えらびなおす</button></p>
              <div className="toolbar">
                <label>本数<Stepper label="本数" unit="本" min={1} max={999} value={qty} onChange={setQty} /></label>
                <label>日付<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
              </div>
              <input placeholder="メモ（任意）" value={note} onChange={(e) => setNote(e.target.value)} />
              <p>給料から引く金額 <b style={{ fontSize: 22 }}>{yen(pick.costPrice * n)}</b></p>
              <button disabled={n < 1} onClick={add}>記録する</button>
            </>
          )}
        </div>
      )}

      {boss && data && data.byPerson.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>この月の合計（給料から引く金額）</b>
          <table className="tbl"><tbody>
            {data.byPerson.map((p) => <tr key={p.membershipId}><td>{p.name}</td><td>{p.count}本</td><td style={{ textAlign: "right" }}><b>{yen(p.total)}</b></td></tr>)}
            <tr><td><b>合計</b></td><td></td><td style={{ textAlign: "right" }}><b>{yen(data.total)}</b></td></tr>
          </tbody></table>
        </div>
      )}
      {!boss && data && <div className="card" style={{ marginBottom: 12 }}><div className="sub">この月に、給料から引く金額</div><div style={{ fontSize: 28, fontWeight: 700 }}>{yen(data.total)}</div></div>}

      <div className="toolbar"><button className="ghost" onClick={async () => { setOk((await copyText(tsv())) ? "表をコピーしました（エクセル・メールに貼れます）" : "コピーできませんでした"); }}>表をコピー</button><button className="ghost" onClick={() => window.print()}>印刷</button></div>
      {data && data.rows.length === 0 && <p className="hint">この月の記録はまだありません。</p>}
      <ul className="list">
        {(data?.rows ?? []).map((r) => (
          <li key={r.id} style={{ display: "block" }}>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <div><b>{md(r.day)}　{r.name}</b>{r.spec ? `（${r.spec}）` : ""}　{r.qty}本<br /><span className="sub">{boss ? `${r.buyer}　` : ""}{yen(r.unitPrice)}×{r.qty}{r.note ? `　${r.note}` : ""}</span></div>
              <div style={{ textAlign: "right" }}><b>{yen(r.amount)}</b>{own && (boss || r.createdBy === me.id) && <div><button className="ghost" onClick={() => cancel(r)}>取り消す</button></div>}</div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
export default function StaffBuyPage() { return <MeProvider><Page /></MeProvider>; }
