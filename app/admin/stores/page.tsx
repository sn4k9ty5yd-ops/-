"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import type { StoreRow } from "@/lib/service";

export default function StoresPage() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<StoreRow[]>("/api/stores").then(setStores).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  const run = async (body: object) => { try { await api("/api/stores", body); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); } };
  const editable = me.level === 4;
  const active = stores.filter((s) => s.status === "active");
  const closed = stores.filter((s) => s.status === "closed");

  return (
    <>
      <h1>お店</h1>
      <ul className="list">
        {active.map((s, i) => (
          <li key={s.id}>
            <b>{s.name}</b>
            {editable && (
              <div className="actions">
                <button className="ghost" style={{ color: "var(--ink)" }} disabled={i === 0} onClick={() => run({ action: "up", storeId: s.id })} aria-label="上へ">↑</button>
                <button className="ghost" style={{ color: "var(--ink)" }} disabled={i === active.length - 1} onClick={() => run({ action: "down", storeId: s.id })} aria-label="下へ">↓</button>
                <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => { const n = prompt("新しいお店の名前", s.name); if (n && n !== s.name) run({ action: "rename", storeId: s.id, name: n }); }}>名前を変える</button>
                <button className="ghost" onClick={() => confirm(`${s.name} を閉店にしますか？（過去のデータは残ります）`) && run({ action: "close", storeId: s.id })}>閉店</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editable ? (
        <form onSubmit={async (e) => { e.preventDefault(); await run({ action: "add", name }); setName(""); }}>
          <label htmlFor="n">新しいお店（新店オープン）</label>
          <input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">お店を追加</button>
        </form>
      ) : <p className="hint">お店の追加・変更ができるのは、レベル4（オフィス）だけです。</p>}
      {closed.length > 0 && (
        <>
          <h2>閉店したお店</h2>
          <ul className="list">
            {closed.map((s) => (
              <li key={s.id} className="off"><b>{s.name}</b>
                {editable && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => run({ action: "reopen", storeId: s.id })}>再開する</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">変更すると、全員の画面に自動で反映されます（開いている画面は30秒ごとに更新されます）。</p>
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
