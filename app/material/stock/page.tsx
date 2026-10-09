"use client";
import Link from "next/link";
import { Stepper } from "@/app/Stepper";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { materialTabs } from "@/lib/material-tabs";
import { PRODUCT_KIND_LABEL, type MovementRow, type ProductKind, type StockItem, type StockSettings, type StoreRow } from "@/lib/service";

type Tab = "list" | "reorder" | "recount" | "history";
const KIND_JA = { in: "入庫", out: "出庫", recount: "数え直し" } as const;
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
const toInt = (raw: string) => raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [tab, setTab] = useState<Tab>("list");
  const [data, setData] = useState<{ settings: StockSettings; items: StockItem[] } | null>(null);
  const [kinds, setKinds] = useState<ProductKind[]>(["retail", "supply"]);
  const [kind, setKind] = useState<ProductKind>("supply");
  const [q, setQ] = useState("");
  const [move, setMove] = useState<{ item: StockItem; kind: "in" | "out"; qty: string; note: string } | null>(null);
  const [detail, setDetail] = useState<{ item: StockItem; history: MovementRow[]; min: string; target: string } | null>(null);
  const [history, setHistory] = useState<MovementRow[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");

  const own = me.level === 4 || storeId === me.storeId;
  const canEdit = me.level >= 2 && own;
  const canSettings = me.level === 4 || (me.level === 3 && storeId === me.storeId);

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))); }, []);
  const load = useCallback(async () => {
    const r = await api<{ settings: StockSettings; items: StockItem[] }>(`/api/stock?storeId=${storeId}`);
    setData(r);
    const ks: ProductKind[] = [...(r.settings.trackSupply ? (["supply"] as const) : []), ...(r.settings.trackRetail ? (["retail"] as const) : [])];
    setKinds(ks); setKind((k) => (ks.includes(k) ? k : ks[0] ?? "supply"));
    if (tab === "history") setHistory(await api<MovementRow[]>(`/api/stock?storeId=${storeId}&history=1&limit=200`));
  }, [storeId, tab]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { if (!move && !detail && !showSettings && Object.keys(counts).length === 0) load().catch(() => {}); });
  const s = data?.settings;
  useEffect(() => { if (s && ((tab === "reorder" && !s.useReorder) || (tab === "recount" && !s.useRecount))) setTab("list"); }, [s, tab]);

  const shown = useMemo(() => (data?.items ?? []).filter((i) => i.kind === kind && (!q || `${i.maker}${i.name}${i.spec}`.toLowerCase().includes(q.toLowerCase()))), [data, kind, q]);
  const lowItems = (data?.items ?? []).filter((i) => i.low);
  const run = async (body: object, ok = "") => { try { await api("/api/stock", { storeId, ...body }); setMsg(""); await load(); setNote(ok); return true; } catch (e) { setMsg((e as Error).message); return false; } };

  const openDetail = async (item: StockItem) => {
    const h = await api<MovementRow[]>(`/api/stock?storeId=${storeId}&history=1&productId=${item.productId}&limit=30`);
    setDetail({ item, history: h, min: item.min === null ? "" : String(item.min), target: item.target === null ? "" : String(item.target) });
  };
  const reorderTsv = () => ["商品\t規格\t現在\t発注点\t補充の目標\t発注の目安", ...lowItems.map((i) => [i.name, i.spec, i.quantity, i.min ?? "", i.target ?? "", i.suggested ?? ""].join("\t"))].join("\n");
  const storeName = stores.find((x) => x.id === storeId)?.name ?? "";
  const tabs: [Tab, string, boolean][] = [["list", "在庫一覧", true], ["reorder", `発注の目安${lowItems.length ? `（${lowItems.length}）` : ""}`, !!s?.useReorder], ["recount", "数え直し", !!s?.useRecount], ["history", "履歴", true]];

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>材料費</h1>
      <SubTabs items={materialTabs(me.displayOnly)} />
      <p className="sub">自分のお店の在庫が見られます（他のお店は見えません）。入庫・出庫・数え直しの記録は、シフト担当・店長・正美さんができます。</p>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => { setStoreId(e.target.value); setCounts({}); }}>{(me.level === 4 ? stores : stores.filter((x) => x.id === me.storeId)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {canSettings && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setShowSettings(true)}>このお店で使う機能</button>}
      </div>
      <div className="seg">{tabs.filter(([, , on]) => on).map(([t, l]) => <button key={t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setCounts({}); }}>{l}</button>)}</div>
      {!own && <p className="sub">他のお店の在庫です（見るだけ）。</p>}
      {msg && !move && !detail && !showSettings && <p className="err">{msg}</p>}{note && <p className="sub">{note}</p>}

      {tab === "list" && (
        <>
          <div className="toolbar">
            {kinds.length > 1 && <div className="seg" style={{ margin: 0 }}>{kinds.map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{PRODUCT_KIND_LABEL[k]}</button>)}</div>}
            <input aria-label="さがす" placeholder="メーカー・品名でさがす" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
          </div>
          {data && kinds.length === 0 && <p className="hint">このお店では、店販も業務も管理しない設定です。「このお店で使う機能」から変えられます。</p>}
          {data && kinds.length > 0 && shown.length === 0 && <p className="hint">商品がありません。商品は「商品」の画面で、使うお店を選んで登録します。</p>}
          <ul className="list">
            {shown.map((i) => (
              <li key={i.productId} className="stockrow">
                <div style={{ minWidth: 0, flex: 1, cursor: "pointer" }} onClick={() => openDetail(i)}>
                  <b>{i.name}</b>{i.low && <span className="chip warn">少ない</span>}{i.status === "discontinued" && <span className="chip">取扱い終了</span>}
                  <div className="sub">{[i.maker, i.spec].filter(Boolean).join("　")}</div>
                </div>
                <div className="stockqty"><b>{i.quantity}</b><small>個</small></div>
                {canEdit && s?.useMovements && (
                  <div className="actions">
                    <button className="mvbtn out" onClick={() => setMove({ item: i, kind: "out", qty: "1", note: "" })}>使った −</button>
                    <button className="mvbtn in" onClick={() => setMove({ item: i, kind: "in", qty: "1", note: "" })}>入った ＋</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">商品名をタップすると、履歴と「発注点」の設定が開きます。</p>
        </>
      )}

      {tab === "reorder" && (
        <>
          <h1 className="printonly" style={{ fontSize: 18 }}>{storeName}　発注の目安</h1>
          <div className="actions noprint" style={{ marginBottom: 8 }}>
            <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => window.print()}>印刷</button>
            <button className="ghost" style={{ color: "var(--ink)" }} onClick={async () => setNote((await copyText(reorderTsv())) ? "表をコピーしました" : "コピーできませんでした")}>表をコピー</button>
          </div>
          {lowItems.length === 0 ? <p className="hint">いま、少なくなっている商品はありません。（商品ごとの「発注点」を決めると、ここに出ます）</p> : (
            <div className="scroll"><table className="sttable"><thead><tr><th>商品</th><th className="spec">規格</th><th>現在</th><th>発注点</th><th>補充の目標</th><th>発注の目安</th></tr></thead>
              <tbody>{lowItems.map((i) => <tr key={i.productId}><td className="nm">{i.name}<div className="sub subline">{i.maker}　{i.spec}</div></td><td className="spec">{i.spec}</td><td className="r">{i.quantity}</td><td className="r">{i.min}</td><td className="r">{i.target ?? "—"}</td><td className="r"><b>{i.suggested ?? "—"}</b></td></tr>)}</tbody></table></div>
          )}
        </>
      )}

      {tab === "recount" && (
        <>
          <p className="sub">数えた数を入れてください。いまの在庫との差が「数え直し」として記録され、在庫が合います。入れなかった商品は変わりません。</p>
          <ul className="list">
            {(data?.items ?? []).filter((i) => i.status === "active").map((i) => {
              const v = counts[i.productId]; const diff = v === undefined || v === "" ? null : Number(v) - i.quantity;
              return (
                <li key={i.productId} className="stockrow">
                  <div style={{ flex: 1, minWidth: 0 }}><b>{i.name}</b><div className="sub">{PRODUCT_KIND_LABEL[i.kind]}　{[i.maker, i.spec].filter(Boolean).join("　")}　いま {i.quantity}個</div></div>
                  <Stepper label={`${i.name}の数え直し`} placeholder="—" disabled={!canEdit} value={v ?? ""} max={99999} onChange={(x) => setCounts({ ...counts, [i.productId]: x })} />
                  <span className="sub" style={{ width: 52, textAlign: "right", color: diff ? (diff > 0 ? "#1e7e34" : "#d70015") : undefined }}>{diff === null || diff === 0 ? "" : diff > 0 ? `+${diff}` : diff}</span>
                </li>
              );
            })}
          </ul>
          {canEdit && <button disabled={Object.values(counts).every((v) => v === "")} onClick={async () => {
            const entries = Object.entries(counts).filter(([, v]) => v !== "").map(([productId, v]) => ({ productId, counted: Number(v) }));
            try { const r = await api<{ changed: number }>("/api/stock", { action: "recount", storeId, entries }); setCounts({}); setMsg(""); setNote(`${r.changed}件の在庫を合わせました`); await load(); } catch (e) { setMsg((e as Error).message); }
          }}>数え直しを反映する</button>}
        </>
      )}

      {tab === "history" && (
        <ul className="list">
          {history.map((h) => <li key={h.id}><div><b>{h.name}</b> <span className="chip">{KIND_JA[h.kind]}</span><div className="sub">{h.at}　{h.by ?? ""}{h.note ? `　${h.note}` : ""}</div></div><div style={{ textAlign: "right" }}><b style={{ color: h.delta > 0 ? "#1e7e34" : "#d70015" }}>{h.delta > 0 ? `+${h.delta}` : h.delta}</b><div className="sub">→ {h.after}個</div></div></li>)}
          {history.length === 0 && <p className="hint">まだ記録がありません。</p>}
        </ul>
      )}

      {move && (
        <div className="sheet-bg" onClick={() => setMove(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="入庫・出庫">
            <b style={{ fontSize: 18 }}>{move.item.name}　{move.kind === "out" ? "使った" : "入った"}</b>
            <div className="sub">いまの在庫 {move.item.quantity}個</div>
            <div className="stepper" style={{ margin: "14px 0" }}>
              <button type="button" aria-label="減らす" onClick={() => setMove({ ...move, qty: String(Math.max(1, Number(move.qty || 1) - 1)) })}>−</button>
              <Stepper label="個数" min={1} max={99999} value={move.qty} onChange={(x) => setMove({ ...move, qty: x })} />
              <button type="button" aria-label="増やす" onClick={() => setMove({ ...move, qty: String(Number(move.qty || 0) + 1) })}>＋</button>
              <span className="sub">個</span>
            </div>
            <label>メモ（任意）<input value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} placeholder={move.kind === "in" ? "例：10月の仕入れ" : "例：カラー施術で使用"} /></label>
            {msg && <p className="err">{msg}</p>}
            <button disabled={!move.qty || Number(move.qty) < 1} onClick={async () => { if (await run({ action: "move", items: [{ productId: move.item.productId, kind: move.kind, qty: Number(move.qty), note: move.note }] }, `${move.item.name}を${move.kind === "out" ? "出庫" : "入庫"}しました`)) setMove(null); }}>記録する</button>
            <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => { setMove(null); setMsg(""); }}>キャンセル</button>
          </div>
        </div>
      )}

      {detail && (
        <div className="sheet-bg" onClick={() => setDetail(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="商品の在庫">
            <b style={{ fontSize: 18 }}>{detail.item.name}</b>
            <div className="sub">{[detail.item.maker, detail.item.spec].filter(Boolean).join("　")}　いま {detail.item.quantity}個</div>
            {canSettings && s?.useReorder && (
              <>
                <div className="times"><label>発注点<Stepper label="発注点" placeholder="未設定" max={99999} value={detail.min} onChange={(x) => setDetail({ ...detail, min: x })} clearable /></label>
                  <label>補充の目標<Stepper label="補充の目標" placeholder="未設定" max={99999} value={detail.target} onChange={(x) => setDetail({ ...detail, target: x })} clearable /></label></div>
                <p className="sub" style={{ margin: "4px 0 8px" }}>在庫が「発注点」以下になると「少ない」と出ます。「補充の目標」まで足すのに必要な数が、発注の目安になります。</p>
                <button onClick={async () => { if (await run({ action: "limits", productId: detail.item.productId, min: detail.min === "" ? null : Number(detail.min), target: detail.target === "" ? null : Number(detail.target) }, "発注点を保存しました")) setDetail(null); }}>発注点を保存</button>
              </>
            )}
            <b style={{ display: "block", marginTop: 14 }}>最近の記録</b>
            <ul className="list" style={{ margin: "6px 0" }}>
              {detail.history.map((h) => <li key={h.id}><div><span className="chip">{KIND_JA[h.kind]}</span><div className="sub">{h.at}　{h.by ?? ""}{h.note ? `　${h.note}` : ""}</div></div><b style={{ color: h.delta > 0 ? "#1e7e34" : "#d70015" }}>{h.delta > 0 ? `+${h.delta}` : h.delta}</b></li>)}
              {detail.history.length === 0 && <p className="hint">記録はまだありません。</p>}
            </ul>
            <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => setDetail(null)}>閉じる</button>
          </div>
        </div>
      )}

      {showSettings && s && (
        <div className="sheet-bg" onClick={() => setShowSettings(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="使う機能">
            <b style={{ fontSize: 18 }}>{storeName}で使う機能</b>
            <p className="sub">使いたい機能にチェックを入れてください。いつでも変えられます。</p>
            {([["useMovements", "入庫・出庫の記録（使った・入った）"], ["useRecount", "数え直し（数えた数を入れ直す）"], ["useReorder", "発注の目安（少なくなったらお知らせ）"], ["trackSupply", "業務（材料）を管理する"], ["trackRetail", "店販を管理する"]] as [keyof StockSettings, string][]).map(([k, label]) => (
              <label key={k} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 16, color: "var(--ink)", margin: "10px 0" }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={s[k]} onChange={(e) => setData({ ...data!, settings: { ...s, [k]: e.target.checked } })} />{label}
              </label>
            ))}
            {msg && <p className="err">{msg}</p>}
            <button onClick={async () => { if (await run({ action: "settings", settings: s }, "使う機能を保存しました")) setShowSettings(false); }}>保存</button>
            <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => { setShowSettings(false); load(); }}>キャンセル</button>
          </div>
        </div>
      )}
    </main>
  );
}
export default function StockPage() { return <MeProvider><Page /></MeProvider>; }
