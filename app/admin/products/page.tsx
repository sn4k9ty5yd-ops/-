"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { parseProductPaste } from "@/lib/paste";
import { findSimilarProduct, parseProductOcr, type ProductCandidate } from "@/lib/product-ocr";
import { PRODUCT_KIND_LABEL, type ProductKind, type ProductRow, type StoreRow } from "@/lib/service";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
type Draft = { id?: string; maker: string; name: string; spec: string; costPrice: string; status: "active" | "discontinued"; storeIds: string[] };

export default function ProductsPage() {
  const { me } = useMe();
  const canEdit = me.level === 4;          // 内容の変更・全体から消す
  const canAdd = me.level >= 3;            // 商品の追加・このお店で使う/使わない
  const [kind, setKind] = useState<ProductKind>("retail");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [storeFilter, setStoreFilter] = useState("");
  const [q, setQ] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paste, setPaste] = useState<{ text: string; storeIds: string[] } | null>(null);
  const [act, setAct] = useState<ProductRow | null>(null);
  const [ocr, setOcr] = useState<{ cands: (ProductCandidate & { use: boolean; dup: string | null })[]; storeIds: string[]; busy: string } | null>(null);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api<StoreRow[]>("/api/stores"), api<ProductRow[]>(`/api/products?kind=${kind}`)]);
    setStores(s.filter((x) => x.status === "active")); setItems(p);
  }, [kind]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { if (!draft && !paste && !act && !ocr) load().catch(() => {}); });

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
      <p className="hint" style={{ marginTop: 0 }}>{kind === "retail" ? "お客様にお売りする商品です。" : "施術で使う材料です。"}仕入値（税抜）は、全店共通です。{canEdit ? "" : canAdd ? "追加と、このお店で使う・使わないの変更ができます。内容の変更と全体から消すのは、オフィスだけです。" : "登録・変更できるのは、オフィス（レベル4）だけです。"}</p>
      <div className="toolbar">
        <select aria-label="お店で絞る" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}><option value="">全店の商品</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}で使う商品</option>)}</select>
        <input aria-label="さがす" placeholder="メーカー・品名でさがす" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
      </div>
      <div className="actions" style={{ marginBottom: 10 }}>
        {canAdd && <button disabled={!ready} style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => setDraft({ maker: "", name: "", spec: "", costPrice: "", status: "active", storeIds: allIds })}>＋ 商品を追加</button>}
        {canAdd && <button disabled={!ready} className="ghost" style={{ color: "var(--blue)" }} onClick={() => setOcr({ cands: [], storeIds: allIds, busy: "" })}>📷 写真から読み込む</button>}
        {canAdd && <button disabled={!ready} className="ghost" style={{ color: "var(--blue)" }} onClick={() => setPaste({ text: "", storeIds: allIds })}>Excelからまとめて登録</button>}
        <label className="sub" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />取扱い終了も表示</label>
        <span className="sub">{shown.length}件</span>{note && <span className="sub">{note}</span>}
      </div>
      {msg && !draft && !paste && <p className="err">{msg}</p>}

      <ul className="list">
        {shown.map((p) => (
          <li key={p.id} className={p.status === "discontinued" ? "off" : ""}>
            <div style={{ minWidth: 0 }}>
              <b>{p.name}</b>{p.status === "discontinued" && <span className="chip warn">取扱い終了</span>}
              <div className="sub">{[p.maker, p.spec].filter(Boolean).join("　")}</div>
              <div className="sub">使うお店：{storesText(p)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b>{yen(p.costPrice)}</b>
              {canAdd && <button className="ghost" style={{ width: "auto", margin: 0, padding: "6px 12px", color: "var(--blue)" }} onClick={() => { setMsg(""); setAct(p); }}>編集</button>}
            </div>
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
      {act && (() => {
        const storeAct = async (storeId: string, on: boolean) => {
          const sn = storeName(storeId);
          if (!on && !confirm(`「${act.name}」を、${sn}から消しますか？\n（商品そのものは消えません。ほかのお店は、そのままです。あとで「また使う」で戻せます）`)) return;
          try { await api(`/api/products/${act.id}`, { storeId, on }); setNote(on ? `${sn}で、また使うようにしました` : `${sn}から消しました`); setMsg(""); setAct(null); await load(); } catch (e) { setMsg((e as Error).message); }
        };
        const myStores = me.level === 4 ? stores : stores.filter((x) => x.id === me.storeId);
        return (
          <div className="sheet-bg" onClick={() => setAct(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="商品の編集" style={{ maxHeight: "90vh", overflow: "auto" }}>
              <b style={{ fontSize: 18 }}>{act.name}</b>
              <div className="sub">{[act.maker, act.spec].filter(Boolean).join("　")}　{yen(act.costPrice)}</div>
              <h3 style={{ margin: "12px 0 4px" }}>お店ごとの使う・使わない</h3>
              {myStores.map((st) => {
                const used = act.storeIds.includes(st.id);
                return (
                  <div key={st.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                    <span><b>{st.name}</b>　{used ? "使っている" : <span className="sub">使っていない</span>}</span>
                    {used
                      ? <button className="ghost" style={{ width: "auto", margin: 0, color: "#b45309" }} onClick={() => storeAct(st.id, false)}>この店舗から消す</button>
                      : <button className="ghost" style={{ width: "auto", margin: 0, color: "var(--blue)" }} onClick={() => storeAct(st.id, true)}>この店舗でまた使う</button>}
                  </div>
                );
              })}
              {canEdit && (
                <>
                  <h3 style={{ margin: "14px 0 4px" }}>全体（全店）</h3>
                  <button className="ghost" style={{ color: "var(--blue)", width: "100%" }} onClick={() => { setDraft({ id: act.id, maker: act.maker, name: act.name, spec: act.spec, costPrice: String(act.costPrice), status: act.status, storeIds: act.storeIds }); setAct(null); }}>内容（名前・仕入値・使うお店）を直す</button>
                  {act.status === "active"
                    ? <button className="ghost" style={{ color: "#d70015", width: "100%" }} onClick={async () => {
                        if (!confirm(`「${act.name}」を、全体（全店）から消しますか？\n\n全${act.storeIds.length}店で、新しい棚卸しに出なくなります。\n（商品も、過去の棚卸しの記録も消えません。「取扱い終了も表示」から、いつでも戻せます）`)) return;
                        try { await api(`/api/products/${act.id}`, { status: "discontinued" }); setNote("全体から消しました（取扱い終了）"); setMsg(""); setAct(null); await load(); } catch (e) { setMsg((e as Error).message); }
                      }}>全体から消す（取扱い終了）</button>
                    : <button className="ghost" style={{ color: "var(--blue)", width: "100%" }} onClick={async () => { try { await api(`/api/products/${act.id}`, { status: "active" }); setNote("取扱いを再開しました"); setMsg(""); setAct(null); await load(); } catch (e) { setMsg((e as Error).message); } }}>取扱いを再開する</button>}
                </>
              )}
              {msg && <p className="err">{msg}</p>}
              <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => { setAct(null); setMsg(""); }}>閉じる</button>
            </div>
          </div>
        );
      })()}

      {ocr && (() => {
        const readFiles = async (files: FileList | null) => {
          if (!files || files.length === 0) return;
          setMsg(""); setOcr((c) => c && { ...c, busy: "読み取っています…（初回は少し時間がかかります）" });
          try {
            const { createWorker } = await import("tesseract.js");
            const w = await createWorker(["jpn", "eng"]);
            const found: ProductCandidate[] = [];
            for (const f of Array.from(files)) { const { data } = await w.recognize(f); found.push(...parseProductOcr(data.text)); }
            await w.terminate();
            const cands = found.map((c) => { const dup = findSimilarProduct(c, items); return { ...c, use: !dup, dup: dup ? `${dup.maker} ${dup.name}`.trim() : null }; });
            setOcr((c) => c && { ...c, cands: [...c.cands, ...cands], busy: "" });
            if (cands.length === 0) setMsg("読み取れませんでした。文字がはっきり写るように、まっすぐ・明るく撮り直してください（または「行を足す」で、手で入れてください）");
          } catch { setOcr((c) => c && { ...c, busy: "" }); setMsg("読み取りに失敗しました（通信を確認してください）"); }
        };
        const upd = (i: number, patch: Partial<ProductCandidate & { use: boolean }>) => setOcr((c) => c && { ...c, cands: c.cands.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        const chosen = ocr.cands.filter((c) => c.use && c.name.trim());
        return (
          <div className="sheet-bg" onClick={() => setOcr(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="写真から読み込む" style={{ maxHeight: "92vh", overflow: "auto", width: "100%", maxWidth: 760 }}>
              <b style={{ fontSize: 18 }}>写真から商品を読み込む（{PRODUCT_KIND_LABEL[kind]}）</b>
              <p className="sub">商品の一覧（リストや棚卸し表）を、まっすぐ・明るく撮った写真をえらびます。読み取った名前は、下の表で直してから「決定」を押すと、全店の一覧に入ります。</p>
              <input type="file" accept="image/*" multiple onChange={(e) => { readFiles(e.target.files); e.target.value = ""; }} />
              {ocr.busy && <p className="hint">{ocr.busy}</p>}
              {ocr.cands.length > 0 && (
                <div className="scroll" style={{ marginTop: 8 }}>
                  <table className="sttable">
                    <thead><tr><th>登録</th><th>メーカー</th><th>品名</th><th>規格</th><th>仕入値（税抜）</th><th></th></tr></thead>
                    <tbody>
                      {ocr.cands.map((c, i) => (
                        <tr key={i} style={c.dup ? { background: "#fff1cc" } : undefined}>
                          <td><input type="checkbox" style={{ width: 20, height: 20 }} checked={c.use} onChange={(e) => upd(i, { use: e.target.checked })} /></td>
                          <td><input aria-label="メーカー" value={c.maker} onChange={(e) => upd(i, { maker: e.target.value })} style={{ width: 100, padding: 6, margin: 0, fontSize: 14 }} /></td>
                          <td><input aria-label="品名" value={c.name} onChange={(e) => upd(i, { name: e.target.value })} style={{ width: 170, padding: 6, margin: 0, fontSize: 14 }} />{c.dup && <small style={{ color: "#b45309", display: "block" }}>すでにあります：{c.dup}</small>}</td>
                          <td><input aria-label="規格" value={c.spec} onChange={(e) => upd(i, { spec: e.target.value })} style={{ width: 70, padding: 6, margin: 0, fontSize: 14 }} /></td>
                          <td><input aria-label="仕入値" inputMode="numeric" value={String(c.costPrice)} onChange={(e) => upd(i, { costPrice: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} style={{ width: 90, padding: 6, margin: 0, fontSize: 14, textAlign: "right" }} /></td>
                          <td><button className="ghost" aria-label="この行を消す" onClick={() => setOcr((cur) => cur && { ...cur, cands: cur.cands.filter((_, j) => j !== i) })}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button className="ghost" style={{ color: "var(--blue)", width: "auto" }} onClick={() => setOcr({ ...ocr, cands: [...ocr.cands, { maker: "", name: "", spec: "", costPrice: 0, use: true, dup: null }] })}>＋行を足す</button>
              <label>使うお店</label>
              <div className="storeboxes">
                <label><input type="checkbox" checked={ocr.storeIds.length === allIds.length} onChange={(e) => setOcr({ ...ocr, storeIds: e.target.checked ? allIds : [] })} />全店で使う</label>
                {stores.map((st) => <label key={st.id}><input type="checkbox" checked={ocr.storeIds.includes(st.id)} onChange={(e) => setOcr({ ...ocr, storeIds: e.target.checked ? [...ocr.storeIds, st.id] : ocr.storeIds.filter((x) => x !== st.id) })} />{st.name}</label>)}
              </div>
              {msg && <p className="err">{msg}</p>}
              <button disabled={chosen.length === 0 || ocr.storeIds.length === 0 || !!ocr.busy} onClick={async () => {
                try {
                  const r = await api<{ created: number; skipped: number }>("/api/products", { kind, items: chosen.map((c) => ({ maker: c.maker, name: c.name, spec: c.spec, costPrice: c.costPrice })), storeIds: ocr.storeIds });
                  setNote(`${r.created}件を登録しました${r.skipped ? `（同じ商品${r.skipped}件は飛ばしました）` : ""}`); setOcr(null); setMsg(""); await load();
                } catch (e) { setMsg((e as Error).message); }
              }}>決定して登録（{chosen.length}件）</button>
              <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={() => { setOcr(null); setMsg(""); }}>キャンセル</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
