"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useMe } from "@/lib/client";
import { mentorTabs } from "@/lib/mentor-tabs";

function Page() {
  const { me } = useMe();
  const [rows, setRows] = useState<{ name: string; storeName: string; mbti: string }[] | null>(null);
  const [q, setQ] = useState(""); const [msg, setMsg] = useState("");
  useEffect(() => { api<{ name: string; storeName: string; mbti: string }[]>("/api/mentor?directory=1").then(setRows).catch((e) => { setMsg((e as Error).message); setRows([]); }); }, []);
  const shown = useMemo(() => (rows ?? []).filter((r) => !q || `${r.name}${r.mbti}${r.storeName}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const stores = [...new Set(shown.map((r) => r.storeName))];
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>メンター</h1>
      <SubTabs items={mentorTabs(me.displayOnly, me.rank)} />
      <p className="sub">みんなのMBTIです（自分のお店の人が見られます。全店は社長以上）。MBTIを入れている人だけが出ます。</p>
      {msg && <p className="err">{msg}</p>}
      <input placeholder="名前・MBTIでさがす（例：ENFP）" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows && rows.length === 0 && !msg && <p className="hint">まだ、MBTIを入れている人がいません。</p>}
      {stores.map((s) => (
        <div key={s}>
          <h2>{s}</h2>
          <ul className="list">{shown.filter((r) => r.storeName === s).map((r) => <li key={r.name + r.mbti}><b>{r.name}</b><span className="chip">{r.mbti}</span></li>)}</ul>
        </div>
      ))}
    </main>
  );
}
export default function MbtiPage() { return <MeProvider><Page /></MeProvider>; }
