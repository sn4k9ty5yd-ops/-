"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh } from "@/lib/client";
import type { NotificationRow } from "@/lib/service";

function Page() {
  const router = useRouter();
  const [data, setData] = useState<{ items: NotificationRow[]; unread: number } | null>(null);
  const load = useCallback(async () => setData(await api("/api/notifications")), []);
  useEffect(() => { load().catch(() => setData({ items: [], unread: 0 })); }, [load]);
  useAutoRefresh(() => { load().catch(() => {}); }, 20);
  return (
    <main style={{ maxWidth: 700 }}>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>お知らせ</h1>
      {data && data.unread > 0 && <button className="ghost" style={{ color: "var(--blue)", width: "auto" }} onClick={async () => { await api("/api/notifications", {}); await load(); }}>すべて読んだことにする</button>}
      {data && data.items.length === 0 && <p className="hint">お知らせは、まだありません。</p>}
      <ul className="list">
        {data?.items.map((n) => (
          <li key={n.id} style={{ display: "block", cursor: n.link ? "pointer" : "default", borderLeft: n.read ? "none" : "4px solid var(--blue)" }}
            onClick={async () => { await api("/api/notifications", { ids: [n.id] }).catch(() => {}); if (n.link) router.push(n.link); else await load(); }}>
            <b>{n.title}</b>
            <div className="sub">{n.createdAt}</div>
            {n.body && <div style={{ marginTop: 4 }}>{n.body}</div>}
          </li>
        ))}
      </ul>
    </main>
  );
}
export default function Inbox() { return <MeProvider><Page /></MeProvider>; }
