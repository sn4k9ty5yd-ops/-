"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { reiwa } from "@/lib/era";
import type { ActivityRow } from "@/lib/service";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
/** 「2026-10-06T09:48:00Z」「2026-10-06 09:48:00+00」など、どの書き方でも、日本時間の日付にする（読めなければ、そのまま出す） */
const when = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim());
  if (!m) return iso;
  const off = m[7] && m[7] !== "Z" ? (m[7][0] === "-" ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4).replace(":", "") || 0)) : 0;
  const j = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - off * 60000 + 9 * 3600000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${reiwa(`${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}`)} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
};

export default function ActivityPage() {
  const { me } = useMe();
  const [data, setData] = useState<{ rows: ActivityRow[]; areas: string[]; people: string[] } | null>(null);
  const [person, setPerson] = useState(""); const [area, setArea] = useState("");
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { setData(await api(`/api/activity?person=${encodeURIComponent(person)}&area=${encodeURIComponent(area)}&limit=300`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [person, area]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  if (!me.appOwner) return <p className="hint">この画面は、アプリ制作者だけが見られます。</p>;
  const tsv = () => ["日時\t人\tレベル\tお店\tどこ\tなにを", ...(data?.rows ?? []).map((r) => [when(r.at), r.userName, r.userLevel, r.storeName ?? "", r.area, r.what].join("\t"))].join("\n");
  return (
    <>
      <h1>変更の記録</h1>
      <p className="sub">だれが・どこを・いつ、変更したかの記録です（新しい順）。正美さんへの提出・報告があったときは、通知も届きます。</p>
      <div className="toolbar">
        <select aria-label="人" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">すべての人</option>{(data?.people ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select aria-label="どこ" value={area} onChange={(e) => setArea(e.target.value)}><option value="">すべての場所</option>{(data?.areas ?? []).map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <button className="ghost" onClick={async () => setNote((await copyText(tsv())) ? "表をコピーしました" : "コピーできませんでした")}>表をコピー</button>
      </div>
      {msg && <p className="err">{msg}</p>}{note && <p className="sub">{note}</p>}
      {data && data.rows.length === 0 && <p className="hint">まだ記録がありません。</p>}
      <ul className="list">
        {(data?.rows ?? []).map((r) => (
          <li key={r.id} style={{ display: "block" }}>
            <b>{r.userName}</b> <span className="chip">{r.userLevel}</span> <span className="sub">{r.storeName ?? ""}</span>
            <div>{r.area}：{r.what}</div>
            <div className="sub">{when(r.at)}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
