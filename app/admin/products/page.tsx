"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { parseProductPaste } from "@/lib/paste";
import { PRODUCT_KIND_LABEL, type ProductKind, type ProductRow, type StoreRow } from "@/lib/service";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
type Draft = { id?: string; maker: string; name: string; spec: string; costPrice: string; status: "active" | "discontinued"; storeIds: string[] };

export default function ProductsPage() {
  const { me } = useMe();
  const canEdit = me.level === 4;
  const [kind, setKind] = useState<ProductKind>("retail");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [storeFilter, setStoreFilter] = useState("");
  const [q, setQ] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paste, setPaste] = useState<{ text: string; storeIds: string[] } | null>(null);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api<StoreRow[]>("/api/stores"), api<ProductRow[]>(`/api/products?kind=${kind}`)]);
    setStores(s.filter((x) => x.status === "active")); setItems(p);
  }, [kind]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { if (!draft && !paste) load().catch(() => {}); });

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const shown = useMemo(() => items.filter((p) =>
    (showEnded || p.status === "active") && (!storeFilter || p.storeIds.includes(storeFilter)) &&
    (!q || `${p.maker}${p.name}${p.spec}`.toLowerCase().includes(q.toLowerCase()))), [items, showEnded, storeFilter, q]);
  const allIds = stores.map((s) => s.id);
  const ready = stores.length > 0;   // お店の一覧が読み込まれるまでは登録できない（「使うお店」が空になるのを防ぐ）
  const storesText = (p: ProductRow) => (p.storeIds.length === 0 ? "（どのお店でも使わない）" : p.storeIds.length === allIds.length ? "全店" : p.storeIds.map(storeName).join("・"));
  const pasted = paste ? parseProductPaste(paste.text) : null;

  const save = async () => {
    if (!draft) return;
    try {
      const body = { maker: draft.maker, name: draft.name, spec: draft.spec, costPrice: Number(draft.costPrice.replace(/[,，¥円\s]/g, "")), status: draft.status, storeIds: draft.storeIds };
      if (draft.id) await api(`/api/products/${draft.id}`, body);
      else await api("/api/products", { kind, items: [{ maker: body.maker, name: body.name, spec: body.spec, costPrice: body.costPrice }], storeIds: draft.storeIds });
      setDraft(null); setMsg(""); await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <>
      <h1>商品一覧</h1>
      <div className="seg">{(["retail", "supply"] as ProductKind[]).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{PRODUCT_KIND_LABEL[k]}</button>)}</div>
      <p className="hint" style={{ marginTop: 0 }}>{kind === "retail" ? "お客様にお売りする商品です。" : "施術で使う材料です。"}仕入値（税抜）は、全店共通です。{canEdit ? "" : "登録・変更できるのは、レベル4（オフィス）だけです。"}</p>
      <div className="toolbar">
        <select aria-label="お店で絞る" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}><option value="">全店の商品</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}で使う商品</option>)}</select>
        <input aria-label="さがす" placeholder="メーカー・品名でさがす" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
      </div>
      <div className="actions" style={{ marginBottom: 10 }}>
        {canEdit && <button disabled={!ready} style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => setDraft({ maker: "", name: "", spec: "", costPrice: "", status: "active", storeIds: allIds })}>＋ 商品を追加</button>}
        {canEdit && <button disabled={!ready} className="ghost" style={{ color: "var(--blue)" }} onClick={() => setPaste({ text: "", storeIds: allIds })}>Excelからまとめて登録</button>}
        <label className="sub" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />取扱い終了も表示</label>
        <span className="sub">{shown.length}件</span>{note && <span className="sub">{note}</span>}
      </div>
      {msg && !draft && !paste && <p className="err">{msg}</p>}

      <ul className="list">
        {shown.map((p) => (
          <li key={p.id} className={p.status === "discontinued" ? "off" : ""} style={{ cursor: canEdit ? "pointer" : "default" }}
              onClick={() => canEdit && setDraft({ id: p.id, maker: p.maker, name: p.name, spec: p.spec, costPrice: String(p.costPrice), status: p.status, storeIds: p.storeIds })}>
            <div style={{ minWidth: 0 }}>
              <b>{p.name}</b>{p.status === "discontinued" && <span className="chip warn">取扱い終了</span>}
              <div className="sub">{[p.maker, p.spec].filter(Boolean).join("　")}</div>
              <div className="sub">使うお店：{storesText(p)}</div>
            </div>
            <b>{yen(p.costPrice)}</b>
          </li>
        ))}
        {shown.length === 0 && <p className="hint">商品がありません。{canEdit ? "「商品を追加」か「Excelからまとめて登録」で登録してください。" : ""}</p>}
      </ul>

      {draft && (
        <div className="sheet-bg" onClick={() => setDraft(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="商品の編集">
            <b style={{ fontSize: 18 }}>{draft.id ? "商品を編集" : `${PRODUCT_KIND_LABEL[kind]}の商品を追加`}</b>
            <label>メーカー<input value={draft.maker} onChange={(e) => setDraft({ ...draft, maker: e.target.value })} /></label>
            <label>品名<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>規格（容量など）<input value={draft.spec} onChange={(e) => setDraft({ ...draft, spec: e.target.value })} /></label>
            <label>仕入値（税抜・円）<input inputMode="numeric" value={draft.costPrice} onChange={(e) => setDraft({ ...draft, costPrice: e.target.value })} /></label>
            <label>使うお店</label>
            <div className="storeboxes">
              <label><input type="checkbox" checked={draft.storeIds.length === allIds.length} onChange={(e) => setDraft({ ...draft, storeIds: e.target.checked ? allIds : [] })} />全店で使う</label>
              {stores.map((s) => <label key={s.id}><input type="checkbox" checked={draft.storeIds.includes(s.id)} onChange={(e) => setDraft({ ...draft, storeIds: e.target.checked ? [...draft.storeIds, s.id] : draft.storeIds.filter((x) => x !== s.id) })} />{s.name}</label>)}
            </div>
            {draft.id && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={draft.status === "discontinued"} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? "discontinued" : "active" })} />取扱い終了にする（過去の棚卸しはそのまま残ります）</label>}
            {msg && <p className="err">{msg}</p>}
            {!draft.id && draft.storeIds.length === 0 && <p className="err">使うお店を1つ以上えらんでください。</p>}
            <button disabled={!draft.id && draft.storeIds.length === 0} onClick={save}>保存</button>
            <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => { setDraft(null); setMsg(""); }}>キャンセル</button>
          </div>
        </div>
      )}

      {paste && pasted && (
        <div className="sheet-bg" onClick={() => setPaste(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="まとめて登録">
            <b style={{ fontSize: 18 }}>Excelからまとめて登録（{PRODUCT_KIND_LABEL[kind]}）</b>
            <p className="sub">Excelの表をコピーして、下にはりつけてください。列の順番は「メーカー・品名・規格・仕入値」です（見出しの行はあってもなくても大丈夫）。</p>
            <textarea aria-label="貼り付け" rows={8} style={{ width: "100%", fontSize: 14, padding: 10, borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" }}
              value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder={"ﾒｰｶｰ\t品名\t規格\t仕入値\nﾐﾙﾎﾞﾝ\tｼｬﾝﾌﾟｰ\t500ml\t1,200"} />
            <p className="sub" style={{ margin: "6px 0" }}>{pasted.items.length}件を登録します{pasted.badLines.length > 0 && `（読めない行が${pasted.badLines.length}件あります）`}</p>
            {pasted.badLines.slice(0, 5).map((b) => <div key={b.line} className="err" style={{ fontSize: 13 }}>{b.line}行目：{b.reason}（{b.text.slice(0, 30)}）</div>)}
            <label>使うお店</label>
            <div className="storeboxes">
              <label><input type="checkbox" checked={paste.storeIds.length === allIds.length} onChange={(e) => setPaste({ ...paste, storeIds: e.target.checked ? allIds : [] })} />全店で使う</label>
              {stores.map((s) => <label key={s.id}><input type="checkbox" checked={paste.storeIds.includes(s.id)} onChange={(e) => setPaste({ ...paste, storeIds: e.target.checked ? [...paste.storeIds, s.id] : paste.storeIds.filter((x) => x !== s.id) })} />{s.name}</label>)}
            </div>
            {msg && <p className="err">{msg}</p>}
            {paste.storeIds.length === 0 && <p className="err">使うお店を1つ以上えらんでください。</p>}
            <button disabled={pasted.items.length === 0 || pasted.badLines.length > 0 || paste.storeIds.length === 0} onClick={async () => {
              try { const r = await api<{ created: number; skipped: number }>("/api/products", { kind, items: pasted.items, storeIds: paste.storeIds }); setNote(`${r.created}件を登録しました${r.skipped ? `（同じ商品${r.skipped}件は飛ばしました）` : ""}`); setPaste(null); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); }
            }}>登録する</button>
            <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => { setPaste(null); setMsg(""); }}>キャンセル</button>
          </div>
        </div>
      )}
    </>
  );
}
