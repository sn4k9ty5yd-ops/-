"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import type { DayInfo } from "@/lib/service";

const KIND: Record<string, string> = { holiday: "公休", paid: "有給", off: "休み", other: "その他" };

function Page() {
  const { me } = useMe();
  const q = useSearchParams();
  const periodId = q.get("periodId") ?? "", storeId = q.get("storeId") ?? "", day = q.get("day") ?? "";
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { setInfo(await api<DayInfo>(`/api/day?periodId=${periodId}&storeId=${storeId}&day=${day}`)); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, [periodId, storeId, day]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 15);
  if (err) return <main><Link href="/inbox" className="back">← お知らせ</Link><p className="err">{err}</p></main>;
  if (!info) return null;
  const over = info.maxOff !== null && info.people.length > info.maxOff;
  return (
    <main style={{ maxWidth: 700 }}>
      <Link href="/inbox" className="back">← お知らせ</Link>
      <h1>{info.label} の休み</h1>
      <div className="card">
        <div>休みの上限：<b>{info.maxOff === null ? "決まっていません" : `${info.maxOff}人まで`}</b>　いま：<b style={over ? { color: "#d70015" } : undefined}>{info.people.length}人</b>{over && <span style={{ color: "#d70015" }}>（上限を超えています）</span>}</div>
        <div style={{ marginTop: 6 }}>{info.people.map((p) => <span key={p.id} className="chip" style={{ marginRight: 6 }}>{p.name}（{KIND[p.kind] ?? p.kind}）</span>)}</div>
        {info.canEdit && over && (
          <button className="ghost" style={{ color: "var(--blue)", width: "auto", marginTop: 8 }} onClick={async () => {
            try { const r = await api<{ people: number }>("/api/day", { action: "notify", periodId, storeId, day }); setNote(`${r.people}人に知らせました`); } catch (e) { setNote((e as Error).message); }
          }}>この日に休みの人に、もう一度知らせる</button>
        )}
        {note && <p className="sub">{note}</p>}
      </div>
      <h2>話し合い</h2>
      <p className="hint">ここに書くと、この日に休みを希望している人と、出勤簿をつける人に、お知らせが届きます。譲れる日・譲れない日などを書いて、調整してください。決まったら、出勤簿をつける人が直します。</p>
      <ul className="list">
        {info.messages.length === 0 && <li><span className="sub">まだ書き込みはありません。</span></li>}
        {info.messages.map((m) => <li key={m.id} style={{ display: "block" }}><div className="sub">{m.name}{m.userId === me.id && "（あなた）"}　{m.at}</div><div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div></li>)}
      </ul>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="メッセージを書く（500文字まで）" style={{ width: "100%", fontSize: 16 }} />
      <button disabled={!text.trim()} onClick={async () => { try { await api("/api/day", { periodId, storeId, day, body: text }); setText(""); await load(); } catch (e) { setErr((e as Error).message); } }}>送る</button>
    </main>
  );
}
export default function ConflictPage() { return <MeProvider><Suspense><Page /></Suspense></MeProvider>; }
