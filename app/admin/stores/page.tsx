"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";

export default function StoresPage() {
  const { me } = useMe();
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<typeof stores>("/api/stores").then(setStores), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1>お店</h1>
      <ul className="list">{stores.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
      {me.level === 4 ? (
        <form onSubmit={async (e) => {
          e.preventDefault();
          try { await api("/api/stores", { name }); setName(""); setMsg(""); load(); } catch (err) { setMsg((err as Error).message); }
        }}>
          <label htmlFor="n">お店の名前</label>
          <input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">お店を追加</button>
        </form>
      ) : <p className="hint">お店の追加・変更ができるのは、レベル4（オフィス）だけです。</p>}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
