"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import type { OfficeInboxRow } from "@/lib/service";

const when = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Page() {
  const { me } = useMe();
  const router = useRouter();
  const [data, setData] = useState<{ items: OfficeInboxRow[]; open: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { try { setData(await api("/api/office-inbox")); setMsg(""); } catch (e) { setMsg((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 20);
  if (me.level < 4) return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>スタッフからの通知</h1><p className="hint">この画面は、事務員さん以上が使います。</p></main>;
  const items = (data?.items ?? []).filter((i) => showDone || !i.done);
  const go = async (n: OfficeInboxRow) => { if (!n.done) await api("/api/office-inbox", { ids: [n.id] }).catch(() => {}); router.push(n.link); };
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>スタッフからの通知</h1>
      <p className="hint">スタッフが事務員さん宛てに出した提出・報告（シフト・出勤簿・棚卸し・売上・有給・材料費）が、ここに集まります。文章を押すと、その画面が開きます。</p>
      {msg && <p className="err">{msg}</p>}
      <div className="toolbar">
        {(data?.open ?? 0) > 0 && <button className="ghost" onClick={async () => { await api("/api/office-inbox", {}); await load(); }}>すべて対応ずみにする</button>}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />対応ずみも見る</label>
      </div>
      {data && items.length === 0 && <p className="hint">{showDone ? "まだ通知はありません。" : "対応待ちの通知は、ありません。"}</p>}
      <ul className="list">
        {items.map((n) => (
          <li key={n.id} style={{ display: "block", cursor: "pointer", borderLeft: n.done ? "none" : "4px solid var(--blue)", opacity: n.done ? 0.65 : 1 }} onClick={() => go(n)}>
            <b>{n.title}</b>
            <div className="sub">{when(n.at)}　{n.done ? `✅ 対応ずみ（${n.doneBy ?? ""}）` : "対応待ち"}</div>
            <div className="sub" style={{ color: "var(--blue)" }}>押すと「{n.area}」の画面が開きます ›</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
export default function StaffNotices() { return <MeProvider><Page /></MeProvider>; }
