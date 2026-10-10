"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";
import type { MaterialDealerRow } from "@/lib/service";

const chip = (on: boolean): React.CSSProperties => ({ width: "auto", padding: "8px 14px", borderRadius: 20, border: on ? "2px solid var(--blue, #0a84ff)" : "1px solid var(--line, #ddd)", background: on ? "var(--blue, #0a84ff)" : "#fff", color: on ? "#fff" : "var(--ink)", fontWeight: 700 });

/** 業者（ディーラー）とカテゴリーを、ボタンで選ぶ。新しい名前は入力すると、保存したときに自動で覚える */
export function DealerPicker({ dealers, supplier, category, onPick }: { dealers: MaterialDealerRow[]; supplier: string; category: string; onPick: (supplier: string, category: string) => void }) {
  const [newDealer, setNewDealer] = useState(false);
  const [newCat, setNewCat] = useState(false);
  const cur = dealers.find((d) => d.name === supplier);
  const known = !!cur;
  const cats = (cur?.categories ?? []).filter((c) => c.active);
  return (
    <>
      <div style={{ margin: "10px 0 4px", fontWeight: 700 }}>業者（ディーラー）</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {dealers.filter((d) => d.active).map((d) => <button key={d.id} type="button" style={chip(supplier === d.name)} onClick={() => { onPick(d.name, d.name === supplier ? category : ""); setNewDealer(false); }}>{d.name}</button>)}
        <button type="button" style={chip(newDealer || (!!supplier && !known))} onClick={() => { setNewDealer(true); if (known) onPick("", ""); }}>＋ ほかの業者</button>
      </div>
      {(newDealer || (!!supplier && !known)) && (
        <>
          <input autoFocus value={supplier} onChange={(e) => onPick(e.target.value, "")} placeholder="業者の名前（保存すると、次から選べます）" style={{ marginTop: 8 }} />
          <p className="hint" style={{ margin: "2px 0 0" }}>新しい業者です。保存すると自動で覚えて、次からボタンで選べます。</p>
        </>
      )}
      {supplier.trim() && (
        <>
          <div style={{ margin: "12px 0 4px", fontWeight: 700 }}>カテゴリー（{supplier.trim()}の中）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" style={chip(category === "" && !newCat)} onClick={() => { onPick(supplier, ""); setNewCat(false); }}>えらばない</button>
            {cats.map((c) => <button key={c.id} type="button" style={chip(category === c.name)} onClick={() => { onPick(supplier, c.name); setNewCat(false); }}>{c.name}</button>)}
            <button type="button" style={chip(newCat || (!!category && !cats.some((c) => c.name === category)))} onClick={() => { setNewCat(true); onPick(supplier, ""); }}>＋ 新しいカテゴリー</button>
          </div>
          {(newCat || (!!category && !cats.some((c) => c.name === category))) && (
            <input autoFocus value={category} onChange={(e) => onPick(supplier, e.target.value)} placeholder="例：カラー・ストレート（保存すると、次から選べます）" style={{ marginTop: 8 }} maxLength={40} />
          )}
        </>
      )}
    </>
  );
}

/** 店長以上: 業者・カテゴリーを、ワンタップで直す（名前を変える・しまう・もどす・上下に動かす・足す） */
export function DealerEditor({ storeId, dealers, onChanged, onClose }: { storeId: string; dealers: MaterialDealerRow[]; onChanged: () => Promise<void> | void; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [nd, setNd] = useState("");
  const [nc, setNc] = useState<Record<string, string>>({});
  const run = async (dealer: Record<string, unknown>) => {
    setMsg("");
    try { await api("/api/material", { action: "dealer", storeId, dealer }); await onChanged(); } catch (e) { setMsg((e as Error).message); }
  };
  const small: React.CSSProperties = { width: "auto", padding: "6px 10px", color: "var(--ink)" };
  const view = (
    <div className="sheet-bg" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="業者とカテゴリーの編集" style={{ maxHeight: "88vh", overflow: "auto" }}>
        <h3>業者・カテゴリーを直す</h3>
        <p className="hint">名前を直すと、過去の発注の名前もそろいます。「しまう」と、選ぶ画面に出なくなります（記録は残ります）。</p>
        {msg && <p className="err">{msg}</p>}
        {dealers.map((d, i) => (
          <div key={d.id} className="card" style={{ margin: "8px 0", opacity: d.active ? 1 : 0.55 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input defaultValue={d.name} aria-label="業者の名前" style={{ flex: 1, fontWeight: 700 }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.name) run({ kind: "dealer", id: d.id, name: v }); else e.target.value = d.name; }} />
              <button type="button" className="ghost" style={small} disabled={i === 0} onClick={() => run({ kind: "dealer", id: d.id, move: "up" })} aria-label="上へ">↑</button>
              <button type="button" className="ghost" style={small} disabled={i === dealers.length - 1} onClick={() => run({ kind: "dealer", id: d.id, move: "down" })} aria-label="下へ">↓</button>
              <button type="button" className="ghost" style={small} onClick={() => run({ kind: "dealer", id: d.id, active: !d.active })}>{d.active ? "しまう" : "もどす"}</button>
            </div>
            <div style={{ marginLeft: 14, marginTop: 6 }}>
              {d.categories.map((c, j) => (
                <div key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0", opacity: c.active ? 1 : 0.55 }}>
                  <span className="sub">└</span>
                  <input defaultValue={c.name} aria-label="カテゴリーの名前" style={{ flex: 1 }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) run({ kind: "category", id: c.id, name: v }); else e.target.value = c.name; }} />
                  <button type="button" className="ghost" style={small} disabled={j === 0} onClick={() => run({ kind: "category", id: c.id, move: "up" })} aria-label="上へ">↑</button>
                  <button type="button" className="ghost" style={small} disabled={j === d.categories.length - 1} onClick={() => run({ kind: "category", id: c.id, move: "down" })} aria-label="下へ">↓</button>
                  <button type="button" className="ghost" style={small} onClick={() => run({ kind: "category", id: c.id, active: !c.active })}>{c.active ? "しまう" : "もどす"}</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input value={nc[d.id] ?? ""} onChange={(e) => setNc({ ...nc, [d.id]: e.target.value })} placeholder="カテゴリーを足す（例：カラー）" maxLength={40} style={{ flex: 1 }} />
                <button type="button" style={{ width: "auto" }} disabled={!(nc[d.id] ?? "").trim()} onClick={async () => { await run({ kind: "category", dealerId: d.id, name: nc[d.id] }); setNc({ ...nc, [d.id]: "" }); }}>足す</button>
              </div>
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input value={nd} onChange={(e) => setNd(e.target.value)} placeholder="業者を足す（例：髪ドラ）" maxLength={80} style={{ flex: 1 }} />
          <button type="button" style={{ width: "auto" }} disabled={!nd.trim()} onClick={async () => { await run({ kind: "dealer", name: nd }); setNd(""); }}>足す</button>
        </div>
        <div className="toolbar"><button className="ghost" onClick={onClose}>閉じる</button></div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(view, document.body);
}
