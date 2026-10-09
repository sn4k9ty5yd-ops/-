"use client";
import Link from "next/link";
import { Stepper } from "@/app/Stepper";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { materialTabs } from "@/lib/material-tabs";
import { todayJst } from "@/lib/period-nav";
import { parseUsageText, type UsageCandidate } from "@/lib/usage-ocr";
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

  // 写真（メモ・画面）から読み込む: ブラウザの中で文字を読み取る（お金はかからない）→ 表で直す → まとめて記録
  const [reading, setReading] = useState("");
  const [cands, setCands] = useState<(UsageCandidate & { on: boolean })[] | null>(null);
  const storeProducts = useMemo(() => products.filter((p) => p.storeIds.includes(storeId)), [products, storeId]);
  const readPhoto = async (file: File) => {
    setMsg(""); setOk(""); setReading("読み取っています…（初回は少し時間がかかります）");
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      const { createWorker } = await import("tesseract.js");
      const w = await createWorker(["jpn", "eng"]);
      const { data } = await w.recognize(c.toDataURL("image/jpeg", 0.9));
      await w.terminate();
      const r = parseUsageText(data.text, storeProducts).map((x) => ({ ...x, on: x.productId !== null }));
      setCands(r);
      if (r.length === 0) setMsg("商品の行を読み取れませんでした。大きく・まっすぐ撮り直すか、下の「商品をさがす」から入れてください。");
    } catch { setMsg("写真を読みこめませんでした"); }
    setReading("");
  };
  const saveCands = async () => {
    const list = (cands ?? []).filter((x) => x.on && x.productId && x.qty >= 1);
    if (list.length === 0) { setMsg("記録する行がありません"); return; }
    let done = 0;
    try {
      for (const x of list) { await api("/api/tester", { action: "add", storeId, productId: x.productId, qty: x.qty, day, note: "写真から" }); done++; }
      setCands(null); setOk(`${done}件を記録しました`); await load();
    } catch (e) { setMsg(`${done}件を記録したところで止まりました：${(e as Error).message}`); await load(); }
  };

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>材料費</h1>
      <SubTabs items={materialTabs(me.displayOnly)} />
      <p className="sub">店販として仕入れた商品を、お客様へのテスターなど、サロンワークで使った（業務に回した）分を記録します（事務所への報告用）。金額は、商品の仕入値×本数で自動で出ます。</p>
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
          <b>業務に回した商品を記録する</b>
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
                <label>本数<Stepper label="本数" unit="本" min={1} max={999} value={qty} onChange={setQty} /></label>
                <label>日付<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
              </div>
              <input placeholder="メモ（任意）" value={note} onChange={(e) => setNote(e.target.value)} />
              <p>合計 <b style={{ fontSize: 22 }}>{yen(pick.costPrice * n)}</b></p>
              <button disabled={n < 1} onClick={add}>記録する</button>
            </>
          )}
        </div>
      )}

      {own && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>📷 写真から読み込む</b>
          <p className="sub" style={{ margin: "4px 0" }}>使った商品と本数を書いたメモ（または画面）の写真をえらぶと、文字を読み取って、商品に合わせます。まちがいは、下の表で直してから記録できます。</p>
          <label className="ghost" style={{ display: "inline-block", cursor: "pointer", padding: "10px 16px", border: "1px solid var(--line, #ddd)", borderRadius: 20 }}>
            写真をえらぶ・撮る
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readPhoto(f); }} />
          </label>
          {reading && <p className="sub">{reading}</p>}
          {cands && cands.length > 0 && (
            <>
              <p className="sub">日付：<input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "auto" }} />　合っている行にチェック。商品と本数は直せます。</p>
              {cands.map((x, i) => {
                const pr = storeProducts.find((p) => p.id === x.productId);
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
                    <input type="checkbox" checked={x.on} onChange={(e) => setCands(cands.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} style={{ width: 22, height: 22 }} aria-label="記録する" />
                    <select value={x.productId ?? ""} onChange={(e) => setCands(cands.map((y, j) => (j === i ? { ...y, productId: e.target.value || null, on: !!e.target.value } : y)))} style={{ flex: 3, minWidth: 160 }}>
                      <option value="">（商品をえらぶ）</option>
                      {storeProducts.map((p) => <option key={p.id} value={p.id}>{p.maker} {p.name}{p.spec ? `（${p.spec}）` : ""}</option>)}
                    </select>
                    <Stepper className="cellstp" label="本数" min={0} max={999} value={String(x.qty)} onChange={(v) => setCands(cands.map((y, j) => (j === i ? { ...y, qty: Number(v) || 0 } : y)))} />本
                    <span className="sub" style={{ minWidth: 70 }}>{pr ? yen(pr.costPrice * x.qty) : ""}</span>
                    <span className="sub" style={{ flexBasis: "100%", opacity: 0.7 }}>読み取り：{x.raw}</span>
                  </div>
                );
              })}
              <p>合計 <b>{yen((cands ?? []).filter((x) => x.on).reduce((t, x) => t + (storeProducts.find((p) => p.id === x.productId)?.costPrice ?? 0) * x.qty, 0))}</b></p>
              <div className="toolbar"><button onClick={saveCands}>チェックした行を記録する</button><button className="ghost" onClick={() => setCands(null)}>やめる</button></div>
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
