"use client";
import { useState } from "react";
import { useApp } from "@/lib/store";

export default function StoresPage() {
  const { stores, can, addStore } = useApp();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const canManage = can("store.manage", "");
  return (
    <>
      <h1>お店</h1>
      <ul className="list">
        {stores.map((s) => <li key={s.id}>{s.name}</li>)}
      </ul>
      {canManage ? (
        <form onSubmit={(e) => {
          e.preventDefault();
          try { addStore(name.trim()); setName(""); setMsg(""); } catch (err) { setMsg((err as Error).message); }
        }}>
          <label htmlFor="n">お店の名前</label>
          <input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">お店を追加</button>
        </form>
      ) : (
        <p className="hint">お店の追加・変更ができるのは、レベル4（オフィス）だけです。</p>
      )}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
