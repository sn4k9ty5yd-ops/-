"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";
import type { MaterialDealerRow } from "@/lib/service";

/** 選ばれているボタンは、アプリ共通の「青いボタン」。選ばれていないボタンは、白い「ghost」ボタン */
const chipCls = (on: boolean) => (on ? "" : "ghost");
const chip = (on: boolean, dashed = false): React.CSSProperties => ({ width: "auto", padding: "8px 14px", borderRadius: 20, fontWeight: 700, ...(on ? {} : { color: "var(--ink)", border: `1px ${dashed ? "dashed" : "solid"} var(--line, #bbb)`, background: "#fff", boxShadow: "none" }) });

/** 業者（ディーラー）とカテゴリーを、ボタンで選ぶ。「＋」から、誰でもその場で足せる（足すとすぐ覚えて、次からボタンに出る） */
export function DealerPicker({ dealers, supplier, category, onPick, onAdd }: { dealers: MaterialDealerRow[]; supplier: string; category: string; onPick: (supplier: string, category: string) => void; onAdd: (supplier: string, category: string) => Promise<void> }) {
  const [addDealer, setAddDealer] = useState(false);
  const [dName, setDName] = useState("");
  const [addCat, setAddCat] = useState(false);
  const [cName, setCName] = useState("");
  const [msg, setMsg] = useState("");
  const cur = dealers.find((d) => d.name === supplier);
  const cats = (cur?.categories ?? []).filter((c) => c.active);
  const add = async (sup: string, cat: string, done: () => void) => {
    setMsg("");
    try { await onAdd(sup, cat); onPick(sup, cat); done(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <div style={{ margin: "10px 0 4px", fontWeight: 700 }}>業者（ディーラー）</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {dealers.filter((d) => d.active).map((d) => <button key={d.id} type="button" className={chipCls(supplier === d.name)} style={chip(supplier === d.name)} onClick={() => { onPick(d.name, d.name === supplier ? category : ""); setAddDealer(false); }}>{d.name}</button>)}
        <button type="button" className="ghost" style={chip(false, true)} onClick={() => { setAddDealer(!addDealer); setMsg(""); }}>＋ 業者を足す</button>
      </div>
      {addDealer && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input autoFocus value={dName} onChange={(e) => setDName(e.target.value)} placeholder="業者の名前（足すと、次からボタンに出ます）" maxLength={80} style={{ flex: 1 }} />
          <button type="button" style={{ width: "auto" }} disabled={!dName.trim()} onClick={() => add(dName.trim(), "", () => { setDName(""); setAddDealer(false); })}>追加</button>
        </div>
      )}
      {supplier.trim() && (
        <>
          <div style={{ margin: "12px 0 4px", fontWeight: 700 }}>カテゴリー（{supplier.trim()}の中）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className={chipCls(category === "")} style={chip(category === "")} onClick={() => onPick(supplier, "")}>えらばない</button>
            {cats.map((c) => <button key={c.id} type="button" className={chipCls(category === c.name)} style={chip(category === c.name)} onClick={() => { onPick(supplier, c.name); setAddCat(false); }}>{c.name}</button>)}
            <button type="button" className="ghost" style={chip(false, true)} onClick={() => { setAddCat(!addCat); setMsg(""); }}>＋ カテゴリーを足す</button>
          </div>
          {addCat && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input autoFocus value={cName} onChange={(e) => setCName(e.target.value)} placeholder="例：カラー・ストレート（足すと、次からボタンに出ます）" maxLength={40} style={{ flex: 1 }} />
              <button type="button" style={{ width: "auto" }} disabled={!cName.trim()} onClick={() => add(supplier.trim(), cName.trim(), () => { setCName(""); setAddCat(false); })}>追加</button>
            </div>
          )}
        </>
      )}
      {msg && <p className="err" style={{ margin: "6px 0 0" }}>{msg}</p>}
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
