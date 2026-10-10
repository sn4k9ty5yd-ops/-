"use client";
import Link from "next/link";
import { Stepper } from "@/app/Stepper";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { materialTabs } from "@/lib/material-tabs";
import { applyMemory, findSupplier, parseOrderText, similarity, type OrderLine } from "@/lib/material-ocr";
import { itemsByMonthTable, monthItems } from "@/lib/material-items";
import { todayJst } from "@/lib/period-nav";
import { DealerEditor, DealerPicker } from "./DealerPicker";
import { MATERIAL_KIND_LABEL, toExTax, type MaterialDealerRow, type MaterialImage, type MaterialMemory, type MaterialKind, type MaterialLogRow, type MaterialOrder, type ProductRow, type StoreRow } from "@/lib/service";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const toInt = (raw: string) => raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
/** 画像を小さくして（長い辺1600px・JPEG）、base64にする */
async function shrink(file: File): Promise<{ mime: string; base64: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", base64: url.split(",")[1], preview: url };
}
interface Pic { mime: string; base64: string; preview: string }
interface Form { id?: string; orderedOn: string; supplier: string; category: string; item: string; kind: MaterialKind; amount: string; note: string; pics: Pic[]; lines: OrderLine[] | null; tax: "ex" | "in" }

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [data, setData] = useState<{ orders: MaterialOrder[]; suppliers: string[]; budget: number | null; images: MaterialImage[] } | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [hist, setHist] = useState<MaterialOrder[] | null>(null);
  useEffect(() => { setHist(null); }, [storeId, ym]);
  const [pq, setPq] = useState("");
  const [newP, setNewP] = useState<{ kind: "retail" | "supply"; maker: string; name: string; spec: string; cost: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");
  const [log, setLog] = useState<MaterialLogRow[] | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);

  const mgr = !!me.materialManager;
  const own = me.level === 4 || mgr || storeId === me.storeId;
  const canEdit = own && !me.displayOnly;
  const canBudget = me.level === 4 || (me.level === 3 && storeId === me.storeId);
  const month = `${ym}-01`;

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);
  const loadProducts = useCallback(async (): Promise<ProductRow[]> => {
    try { const [a, b] = await Promise.all([api<ProductRow[]>("/api/products?kind=supply"), api<ProductRow[]>("/api/products?kind=retail")]); const l = [...b, ...a].filter((p) => p.status === "active" && p.storeIds.includes(storeId)); setProducts(l); return l; } catch { setProducts([]); return []; }
  }, [storeId]);
  const load = useCallback(async () => {
    const r = await api<{ orders: MaterialOrder[]; suppliers: string[]; budget: number | null; images: MaterialImage[] }>(`/api/material?storeId=${storeId}&from=${ym}-01&to=${ym}-${lastDay(ym)}&month=${month}`);
    setData(r);
  }, [storeId, ym, month]);
  useEffect(() => { load().catch((e) => setMsg((e as Error).message)); }, [load]);
  useAutoRefresh(() => { if (!form && budgetEdit === null) load().catch(() => {}); });

  const live = useMemo(() => (data?.orders ?? []).filter((o) => !o.deleted), [data]);
  const total = live.reduce((s, o) => s + o.amount, 0);
  const byKind = (Object.keys(MATERIAL_KIND_LABEL) as MaterialKind[]).map((k) => [k, live.filter((o) => o.kind === k).reduce((s, o) => s + o.amount, 0)] as const).filter(([, v]) => v > 0);
  const bySupplier = useMemo(() => { const m = new Map<string, number>(); for (const o of live) m.set(o.supplier, (m.get(o.supplier) ?? 0) + o.amount); return [...m].sort((a, b) => b[1] - a[1]); }, [live]);
  const storeName = stores.find((x) => x.id === storeId)?.name ?? "";
  const budget = data?.budget ?? null;

  const save = async () => {
    if (!form) return;
    const input = { taxMode: form.tax, orderedOn: form.orderedOn, supplier: form.supplier, category: form.category, item: form.item, kind: form.kind, amount: Number(form.amount || "x"), note: form.note, ...(form.lines ? { lines: form.lines } : {}) };
    try {
      const r = await api<{ id?: string }>("/api/material", form.id ? { action: "update", id: form.id, input } : { action: "add", storeId, input });
      const oid = form.id ?? r.id;
      for (const p of form.pics) await api("/api/material", { action: "image", id: oid, image: { mime: p.mime, base64: p.base64 } });
      setForm(null); setMsg(""); setNote(form.id ? "直しました" : "記録しました"); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const addPics = async (files: FileList | File[] | null) => {
    if (!files || !form) return;
    try {
      const pics: Pic[] = [];
      for (const f of Array.from(files)) if (f.type.startsWith("image/")) pics.push(await shrink(f));
      setForm((cur) => (cur ? { ...cur, pics: [...cur.pics, ...pics] } : cur));
      for (const p of pics) await readPic(p);   // 貼ったら、自動で文字を読み取って、明細の下書きにする
    } catch { setMsg("画像を読みこめませんでした"); }
  };
  const [reading, setReading] = useState("");
  const [dealers, setDealers] = useState<{ dealers: MaterialDealerRow[]; canManage: boolean }>({ dealers: [], canManage: false });
  const [editDealers, setEditDealers] = useState(false);
  const loadDealers = useCallback(async () => { try { setDealers(await api(`/api/material?storeId=${storeId}&dealers=1`)); } catch { /* 無視 */ } }, [storeId]);
  useEffect(() => { loadDealers(); }, [loadDealers, data]);
  const [memory, setMemory] = useState<MaterialMemory>({ suppliers: [], items: [], aliases: [], supplierTax: {} });
  useEffect(() => { api<MaterialMemory>(`/api/material?storeId=${storeId}&memory=1`).then(setMemory).catch(() => {}); }, [storeId, data]);
  /** 画像の文字を読み取って、明細の下書きにする（スマホ・パソコンの中で読む。お金はかからない） */
  const readPic = async (p: Pic) => {
    setMsg(""); setReading("読み取っています…（初回は少し時間がかかります）");
    try {
      const { createWorker } = await import("tesseract.js");
      const w = await createWorker(["jpn", "eng"]);
      const { data } = await w.recognize(p.preview);
      await w.terminate();
      const r = parseOrderText(data.text);
      r.lines = applyMemory(r.lines, memory);                  // 今までに入れた商品名・直し方に合わせる（学習）
      // 商品の登録（商品一覧）にある商品なら、その名前に合わせる（月ごとの集計で、同じ商品としてまとまる）
      const prods = products.length > 0 ? products : await loadProducts();
      r.lines = r.lines.map((l) => {
        let best: { p: ProductRow; s: number } | null = null;
        for (const p of prods) { const s = Math.max(similarity(l.name, p.name), similarity(l.name, `${p.maker}${p.name}`), similarity(l.name, `${p.maker}${p.name}${p.spec}`)); if (!best || s > best.s) best = { p, s }; }
        return best && best.s >= 0.75 ? { ...l, name: `${best.p.maker ? best.p.maker + " " : ""}${best.p.name}${best.p.spec ? " " + best.p.spec : ""}`, raw: l.raw ?? l.name } : l;
      });
      const sup = findSupplier(data.text, memory.suppliers);   // 知っている発注先なら、自動で入れる
      if (r.lines.length === 0) setMsg("商品の行を読み取れませんでした。画像を大きく・まっすぐ撮り直すか、下の「＋行を足す」で入れてください。");
      setForm((cur) => (cur ? { ...cur, supplier: cur.supplier || sup || "", tax: !cur.supplier && sup && memory.supplierTax[sup] ? memory.supplierTax[sup] : cur.tax, lines: [...(cur.lines ?? []), ...r.lines], amount: cur.amount === "" && (r.total ?? 0) > 0 ? String(r.total) : cur.amount } : cur));
    } catch { setMsg("読み取りに失敗しました（通信を確認してください）"); }
    setReading("");
  };
  const cancel = async (o: MaterialOrder) => {
    if (!confirm(`「${md(o.orderedOn)} ${o.supplier} ${yen(o.amount)}」を取り消しますか？\n（記録は消えずに、取り消しとして残ります）`)) return;
    try { await api("/api/material", { action: "cancel", id: o.id }); setForm(null); setNote("取り消しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const saveBudget = async () => {
    try { await api("/api/material", { action: "budget", storeId, month, amount: budgetEdit === "" ? null : Number(budgetEdit) }); setBudgetEdit(null); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const tsv = () => ["日付\t発注先\tカテゴリー\t内容\t種類\t金額（税抜）\tメモ\t記入した人", ...live.slice().reverse().map((o) => [o.orderedOn, o.supplier, o.category ?? "", o.item, MATERIAL_KIND_LABEL[o.kind], o.amount, o.note, o.by ?? ""].join("\t")), `合計\t\t\t\t\t${total}`].join("\n");

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>材料費</h1>
      <SubTabs items={materialTabs(me.displayOnly)} />
      {(me.level === 4 || mgr) && <Link href="/material/summary" className="storelink" style={{ display: "inline-block", marginBottom: 12 }}>材料費統括を見る（全店の割合・月ごと）</Link>}
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {(me.level >= 3 || mgr ? stores : stores.filter((x) => x.id === me.storeId)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="ghost" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="前の月">‹</button>
        <b>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
        <button className="ghost" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      {!own && <p className="sub">他のお店の材料費です（見るだけ）。</p>}
      {msg && !form && <p className="err">{msg}</p>}{note && <p className="sub">{note}</p>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="sub">この月の発注額（税抜）</div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{yen(total)}</div>
        {budget !== null && <div className="sub">予算 {yen(budget)}　{total <= budget ? `あと ${yen(budget - total)}` : <b style={{ color: "var(--red, #c00)" }}>{yen(total - budget)} オーバー</b>}</div>}
        {canBudget && (budgetEdit === null
          ? <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setBudgetEdit(budget === null ? "" : String(budget))}>{budget === null ? "この月の予算を決める" : "予算を変える"}</button>
          : <div className="toolbar"><Stepper label="予算" placeholder="予算（円・税抜）" unit="円" step={1000} bigStep={10000} max={999999999} value={budgetEdit} onChange={setBudgetEdit} /><button onClick={saveBudget}>保存</button><button className="ghost" onClick={() => setBudgetEdit(null)}>やめる</button></div>)}
        {byKind.length > 0 && <div className="sub">{byKind.map(([k, v]) => `${MATERIAL_KIND_LABEL[k]} ${yen(v)}`).join("　／　")}</div>}
        {bySupplier.length > 0 && <div className="sub">発注先ごと: {bySupplier.map(([s, v]) => `${s} ${yen(v)}`).join("　／　")}</div>}
      </div>

      {(() => {
        const items = monthItems(live, ym);
        if (items.length === 0 && !hist) return null;
        const months = [5, 4, 3, 2, 1, 0].map((n) => shiftMonth(ym, -n));
        const table = hist ? itemsByMonthTable(hist, months) : null;
        const itemsTsv = () => ["商品\t個数\t金額（税抜）\t回数", ...items.map((x) => [x.name, x.qty, x.amount, x.orders].join("\t"))].join("\n");
        return (
          <div className="card" style={{ marginBottom: 12 }}>
            <b>この月に発注した商品（何を何個）</b>
            {items.length === 0 ? <p className="sub">この月の発注は、まだありません。</p> : (
              <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>商品</th><th style={{ textAlign: "right" }}>個数</th><th style={{ textAlign: "right" }}>金額</th><th style={{ textAlign: "right" }}>回数</th></tr></thead>
                <tbody>{items.map((x) => <tr key={x.name}><td>{x.name}</td><td style={{ textAlign: "right" }}><b>{x.qty}</b></td><td style={{ textAlign: "right" }}>{yen(x.amount)}</td><td style={{ textAlign: "right" }}>{x.orders}</td></tr>)}</tbody></table></div>
            )}
            <div className="toolbar">
              {items.length > 0 && <button className="ghost" onClick={async () => { setNote((await copyText(itemsTsv())) ? "商品の表をコピーしました" : "コピーできませんでした"); }}>表をコピー</button>}
              {!hist ? <button className="ghost" onClick={async () => { try { const r = await api<{ orders: MaterialOrder[] }>(`/api/material?storeId=${storeId}&from=${months[0]}-01&to=${ym}-${String(lastDay(ym)).padStart(2, "0")}`); setHist(r.orders); } catch (e) { setMsg((e as Error).message); } }}>よく発注している商品（6か月）を見る</button>
                : <button className="ghost" onClick={() => setHist(null)}>6か月の表を閉じる</button>}
            </div>
            {table && (table.rows.length === 0 ? <p className="sub">6か月の記録がありません。</p> : (
              <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>商品（個数の多い順）</th>{months.map((m) => <th key={m} style={{ textAlign: "right" }}>{Number(m.slice(5))}月</th>)}<th style={{ textAlign: "right" }}>合計</th></tr></thead>
                <tbody>{table.rows.slice(0, 40).map((r) => <tr key={r.name}><td>{r.name}</td>{r.byMonth.map((n, i) => <td key={i} style={{ textAlign: "right", color: n ? undefined : "#bbb" }}>{n || "－"}</td>)}<td style={{ textAlign: "right" }}><b>{r.qty}</b></td></tr>)}</tbody></table></div>
            ))}
          </div>
        );
      })()}

      <div className="toolbar">
        {canEdit && <button onClick={() => { setMsg(""); setForm({ orderedOn: todayJst(), supplier: "", category: "", item: "", kind: "supply", amount: "", note: "", pics: [], lines: [], tax: "ex" }); }}>＋ 発注を記録する</button>}
        <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => setNote((await copyText(tsv())) ? "表をコピーしました（Excelやメールに貼れます）" : "コピーできませんでした")}>表をコピー</button>
        <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => window.print()}>印刷</button>
        {(me.level >= 3 || mgr) && <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => setLog(await api<MaterialLogRow[]>(`/api/material?storeId=${storeId}&log=1`))}>変更の記録</button>}
      </div>
      <p className="print-only" style={{ display: "none" }}>{storeName}　{ym}</p>

      {data && (data.orders.length === 0
        ? <p className="hint">この月の記録はまだありません。{canEdit && "「＋ 発注を記録する」から入れてください。"}</p>
        : <ul className="list">
          {data.orders.map((o) => (
            <li key={o.id} style={{ opacity: o.deleted ? 0.5 : 1, textDecoration: o.deleted ? "line-through" : "none", cursor: canEdit && !o.deleted ? "pointer" : "default" }}
              onClick={() => { if (canEdit && !o.deleted) { setMsg(""); setForm({ id: o.id, orderedOn: o.orderedOn, supplier: o.supplier, category: o.category ?? "", item: o.item, kind: o.kind, amount: String(o.amount), note: o.note, pics: [], lines: o.lines ?? [], tax: "ex" }); } }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{md(o.orderedOn)}　{o.supplier}</b>{o.category && <span className="chip">{o.category}</span>}<span className="chip">{MATERIAL_KIND_LABEL[o.kind]}</span>{o.edited && !o.deleted && <span className="chip">直した</span>}{o.deleted && <span className="chip warn">取り消し</span>}
                <div className="sub">{[o.item, o.note, o.by && `記入: ${o.by}`, o.taxMode === "in" && o.entered ? `入力は税込 ${yen(o.entered)}` : ""].filter(Boolean).join("　")}</div>
                {(o.lines ?? []).length > 0 && <details onClick={(e) => e.stopPropagation()}><summary className="sub">明細 {o.lines.length}件</summary>{o.lines.map((l, i) => <div key={i} className="sub">{l.name} ×{l.qty}　{yen(l.amount)}</div>)}</details>}
                {(data.images ?? []).filter((i) => i.orderId === o.id).map((i) => (
                  <a key={i.id} href={`/api/material/image/${i.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", marginRight: 8 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/material/image/${i.id}`} alt="発注画面" style={{ height: 64, borderRadius: 6, border: "1px solid #ddd" }} />
                    <div className="sub" style={{ fontSize: 11 }}>{i.by} {new Date(i.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  </a>))}
              </div>
              <b>{yen(o.amount)}</b>
            </li>
          ))}
        </ul>)}
      <p className="hint">スクリーンショットは、今月と先月の2か月分だけ残り、それより前は自動で消えます（金額・明細などの数字は残ります）。</p>
      <p className="hint">発注画面が税込表示のときは「税込」を選んでください。保存と合計は、いつも<b>税抜</b>になります。記録は消えません（直す・取り消すと、だれがいつ変えたかが残ります）。</p>

      {editDealers && <DealerEditor storeId={storeId} dealers={dealers.dealers} onChanged={loadDealers} onClose={() => setEditDealers(false)} />}
      {form && (
        <div className="sheet-bg" onClick={() => setForm(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="発注の記録">
            <h3>{form.id ? "発注を直す" : "発注を記録する"}</h3>
            <label>発注した日<input type="date" value={form.orderedOn} onChange={(e) => setForm({ ...form, orderedOn: e.target.value })} /></label>
            <DealerPicker dealers={dealers.dealers} supplier={form.supplier} category={form.category} onPick={(sup, cat) => setForm((cur) => cur ? { ...cur, supplier: sup, category: cat, tax: memory.supplierTax[sup] ?? cur.tax } : cur)} onAdd={async (sup, cat) => { await api("/api/material", { action: "choice", storeId, choice: { supplier: sup, category: cat } }); await loadDealers(); }} />
            {dealers.canManage && <p style={{ margin: "6px 0 0" }}><button type="button" className="ghost" style={{ width: "auto", color: "var(--blue)" }} onClick={() => setEditDealers(true)}>✏ 業者・カテゴリーを直す</button></p>}
            <datalist id="itemnames">{memory.items.map((s) => <option key={s} value={s} />)}</datalist>
            <label>種類
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MaterialKind })}>
                {(Object.keys(MATERIAL_KIND_LABEL) as MaterialKind[]).map((k) => <option key={k} value={k}>{MATERIAL_KIND_LABEL[k]}</option>)}
              </select></label>
            <label>この画面の金額は
              <div className="seg" style={{ margin: "4px 0 0" }}>
                <button type="button" className={form.tax === "ex" ? "on" : ""} onClick={() => setForm({ ...form, tax: "ex" })}>税抜</button>
                <button type="button" className={form.tax === "in" ? "on" : ""} onClick={() => setForm({ ...form, tax: "in" })}>税込</button>
              </div></label>
            <label>金額（円・{form.tax === "in" ? "税込で入れる" : "税抜"}）<Stepper label="金額" unit="円" placeholder="金額" step={100} bigStep={1000} max={999999999} value={form.amount} onChange={(x) => setForm({ ...form, amount: x })} />{form.tax === "in" && form.amount !== "" && <span className="sub">→ 税抜に直して保存します：{yen(toExTax(Number(form.amount), "in"))}（税10%）</span>}</label>
            <label>内容<input value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="例: カラー剤・シャンプー" /></label>
            <label>メモ<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <div onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addPics(fs); } }}>
              <label>発注画面のスクリーンショット（貼ると、自動で文字を読み取って明細に入れます。貼った人と日時も自動で記録されます）
                <input type="file" accept="image/*" multiple onChange={(e) => { addPics(e.target.files); e.target.value = ""; }} /></label>
              <input aria-label="ここに画像を貼り付け" placeholder="パソコンでは、ここを押して貼り付け（Ctrl+V）もできます" readOnly style={{ width: "100%" }} />
              <div>{form.pics.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <span key={i} style={{ position: "relative", display: "inline-block", marginRight: 6 }}><img src={p.preview} alt="" style={{ height: 64, borderRadius: 6 }} />
                  <button className="ghost" style={{ position: "absolute", top: -6, right: -6 }} onClick={() => setForm({ ...form, pics: form.pics.filter((_, j) => j !== i) })}>×</button>
</span>))}</div>
              {reading && <p className="sub">{reading}</p>}
              {form.id && (data?.images ?? []).some((i) => i.orderId === form.id) && <p className="sub">すでに付いている画像は、一覧に出ています（手では消せません）。</p>}
            </div>
            {form.lines !== null && (() => {
              const fq = (memory.frequent ?? []).filter((f) => !form.supplier || f.supplier === form.supplier);
              if (fq.length === 0) return null;
              // カテゴリーごとに分ける。いま選んでいるカテゴリーは開いておく（ほかは「▶」を押すと開く）
              const groups = new Map<string, typeof fq>();
              for (const f of fq) groups.set(f.category || "カテゴリーなし", [...(groups.get(f.category || "カテゴリーなし") ?? []), f]);
              const addItem = (f: (typeof fq)[number]) => setForm((cur) => {
                if (!cur) return cur;
                const ls = cur.lines ?? [];
                const i = ls.findIndex((x) => x.name === f.name);
                const lines = i >= 0 ? ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1, amount: x.amount + f.unit } : x)) : [...ls, { name: f.name, qty: 1, amount: f.unit }];
                return { ...cur, supplier: cur.supplier || f.supplier, category: cur.category || f.category, lines };
              });
              return (
                <div>
                  <b>よく使う商品（ポチッと押すと明細に入ります。もう1回押すと数量が増えます）</b>
                  {[...groups].map(([cat, items]) => (
                    <details key={cat} open={form.category ? form.category === cat : groups.size === 1} style={{ margin: "4px 0" }}>
                      <summary className="sub" style={{ cursor: "pointer", fontWeight: 700 }}>{cat}（{items.length}）</summary>
                      <div className="actions" style={{ flexWrap: "wrap" }}>
                        {items.slice(0, 40).map((f) => (
                          <button key={f.supplier + f.category + f.name} className="ghost" style={{ width: "auto", color: "var(--ink)", border: "1px solid var(--line, #ddd)", borderRadius: 20 }} onClick={() => addItem(f)}>{f.name}</button>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              );
            })()}
            {form.lines !== null && (
              <div>
                <b>商品から入れる（金額は、商品の仕入値×数量で自動で出ます）</b>
                <input aria-label="商品をさがす" placeholder="メーカー・品名でさがす（例：髪にドラマを。）" value={pq} onFocus={() => { if (products.length === 0) loadProducts(); }} onChange={(e) => { setPq(e.target.value); if (products.length === 0) loadProducts(); }} />
                {pq.trim() !== "" && (
                  <div className="actions" style={{ flexWrap: "wrap" }}>
                    {products.filter((p) => `${p.maker}${p.name}${p.spec}`.toLowerCase().includes(pq.trim().toLowerCase())).slice(0, 20).map((p) => (
                      <button key={p.id} className="ghost" style={{ width: "auto", color: "var(--ink)", border: "1px solid var(--line, #ddd)", borderRadius: 20 }}
                        onClick={() => setForm((cur) => {
                          if (!cur) return cur;
                          const nm = `${p.maker ? p.maker + " " : ""}${p.name}${p.spec ? " " + p.spec : ""}`;
                          const ls = cur.lines ?? [];
                          const i2 = ls.findIndex((x) => x.name === nm);
                          const lines = i2 >= 0 ? ls.map((x, j2) => (j2 === i2 ? { ...x, qty: x.qty + 1, amount: x.amount + p.costPrice } : x)) : [...ls, { name: nm, qty: 1, amount: p.costPrice }];
                          return { ...cur, tax: "ex", lines, amount: String(lines.reduce((t, l) => t + l.amount, 0)) };
                        })}>{p.name}{p.spec ? `（${p.spec}）` : ""} {p.costPrice.toLocaleString("ja-JP")}円</button>
                    ))}
                    {products.length > 0 && products.filter((p) => `${p.maker}${p.name}${p.spec}`.toLowerCase().includes(pq.trim().toLowerCase())).length === 0 && <span className="sub">見つかりません。</span>}
                  </div>
                )}
                {me.level >= 3 && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setNewP({ kind: "retail", maker: "", name: "", spec: "", cost: "" })}>＋ 新しい商品を登録する</button>}
              </div>
            )}
            {form.lines !== null && (form.lines.length > 0 || form.pics.length > 0) && (
              <div>
                <b>明細（読み取った結果。まちがいは直してください。直した名前は次から自動で覚えます）</b>
                {form.lines.map((l, i) => (
                  <div key={i} className="toolbar" style={{ margin: "4px 0" }}>
                    <input aria-label="商品名" list="itemnames" style={{ flex: 3, minWidth: 120 }} value={l.name} onChange={(e) => setForm({ ...form, lines: form.lines!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <Stepper className="cellstp" label="数量" min={1} value={String(l.qty)} onChange={(v) => setForm({ ...form, lines: form.lines!.map((x, j) => (j === i ? { ...x, qty: Number(v) || 1 } : x)) })} />
                    <Stepper className="cellstp" label="金額" step={100} bigStep={1000} max={999999999} value={String(l.amount)} onChange={(v) => setForm({ ...form, lines: form.lines!.map((x, j) => (j === i ? { ...x, amount: Number(v) || 0 } : x)) })} />
                    <button className="ghost" onClick={() => setForm({ ...form, lines: form.lines!.filter((_, j) => j !== i) })}>×</button>
                  </div>))}
                <div className="toolbar">
                  <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setForm({ ...form, lines: [...form.lines!, { name: "", qty: 1, amount: 0 }] })}>＋行を足す</button>
                  {form.lines.length > 0 && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setForm({ ...form, amount: String(form.lines!.reduce((s, l) => s + l.amount, 0)) })}>明細の合計（{form.tax === "in" ? "税込 " : "税抜 "}{yen(form.lines.reduce((s, l) => s + l.amount, 0))}）を金額に入れる</button>}
                </div>
              </div>)}
            {msg && <p className="err">{msg}</p>}
            <div className="toolbar">
              <button onClick={save} disabled={!form.supplier.trim() || form.amount === ""}>保存</button>
              <button className="ghost" onClick={() => setForm(null)}>やめる</button>
              {form.id && <button className="ghost" style={{ color: "#c00" }} onClick={() => { const o = data?.orders.find((x) => x.id === form.id); if (o) cancel(o); }}>取り消す</button>}
            </div>
          </div>
        </div>
      )}
      {log && (
        <div className="sheet-bg" onClick={() => setLog(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="変更の記録">
            <h3>変更の記録（新しい順）</h3>
            {log.length === 0 && <p className="hint">まだありません。</p>}
            <ul className="list">{log.map((l) => {
              const a = l.after as Record<string, unknown> | null; const b = l.before as Record<string, unknown> | null;
              const diff = l.action === "変更" && a && b ? Object.keys({ ...MATERIAL_KIND_LABEL, ordered_on: 1, supplier: 1, item: 1, amount: 1, note: 1 }).filter((k) => ["ordered_on", "supplier", "item", "amount", "note", "kind"].includes(k) && a[k] !== b[k]).map((k) => `${k === "ordered_on" ? "日付" : k === "supplier" ? "発注先" : k === "item" ? "内容" : k === "amount" ? "金額" : k === "kind" ? "種類" : "メモ"}: ${String(b[k])} → ${String(a[k])}`).join("、") : "";
              return <li key={l.id}><div><b>{l.action}</b>　{a ? `${md(String(a.ordered_on))} ${String(a.supplier)} ${yen(Number(a.amount))}` : ""}<div className="sub">{new Date(l.at).toLocaleString("ja-JP")}　{l.by ?? ""}{diff && `　${diff}`}</div></div></li>;
            })}</ul>
            <button className="ghost" onClick={() => setLog(null)}>閉じる</button>
          </div>
        </div>
      )}
      {newP && (
        <div className="sheet-bg" onClick={() => setNewP(null)}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
          <h2 style={{ marginTop: 0 }}>新しい商品を登録</h2>
          <p className="sub">このお店で使う商品として登録します。仕入値（税抜）を入れると、これからは数量を入れるだけで合計が出ます。</p>
          <div className="seg"><button className={newP.kind === "retail" ? "on" : ""} onClick={() => setNewP({ ...newP, kind: "retail" })}>店販</button><button className={newP.kind === "supply" ? "on" : ""} onClick={() => setNewP({ ...newP, kind: "supply" })}>業務</button></div>
          <input placeholder="メーカー（例：髪にドラマを。）" value={newP.maker} onChange={(e) => setNewP({ ...newP, maker: e.target.value })} />
          <input placeholder="商品名" value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} />
          <input placeholder="規格（例：250ml・任意）" value={newP.spec} onChange={(e) => setNewP({ ...newP, spec: e.target.value })} />
          <Stepper label="仕入値" placeholder="仕入値（税抜・円）" unit="円" step={10} bigStep={100} max={9999999} value={newP.cost} onChange={(x) => setNewP({ ...newP, cost: x })} />
          {msg && <p className="err">{msg}</p>}
          <div className="toolbar">
            <button disabled={!newP.name.trim() || newP.cost === ""} onClick={async () => {
              try { await api("/api/products", { kind: newP.kind, items: [{ maker: newP.maker, name: newP.name, spec: newP.spec, costPrice: Number(newP.cost) }], storeIds: [storeId] }); setNewP(null); setNote("商品を登録しました"); await loadProducts(); setPq(newP.name); } catch (e) { setMsg((e as Error).message); }
            }}>登録する</button>
            <button className="ghost" onClick={() => setNewP(null)}>やめる</button>
          </div>
        </div></div>
      )}
    </main>
  );
}
export default function MaterialPage() { return <MeProvider><Page /></MeProvider>; }
