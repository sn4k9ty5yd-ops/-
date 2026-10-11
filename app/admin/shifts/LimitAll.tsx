"use client";
import { useEffect, useState } from "react";
import { Stepper } from "@/app/Stepper";
import { api } from "@/lib/client";

/** 期間のすべての日に、休みの上限（スタイリスト・アシスタント）をまとめて決める（日ごとの変更は、シフトの「見る」で日にちを押します） */
export function LimitAll({ periodId, storeId, days, onDone }: { periodId: string; storeId: string; days: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setOpen(true)}>休める人数の目安をまとめて決める</button>;
  return (
    <div style={{ width: "100%" }}>
      <LimitRequired periodId={periodId} storeId={storeId} days={days} onChange={onDone} />
      <button className="ghost" style={{ color: "var(--sub)" }} onClick={() => setOpen(false)}>閉じる</button>
    </div>
  );
}

/** 希望休を集める前に必ず決める「1日に、スタイリスト・アシスタントが何人まで休めるか」。スタッフは上限をこえても出せる（目安） */
export function LimitRequired({ periodId, storeId, days, onChange }: { periodId: string; storeId: string; days: string[]; onChange?: () => void }) {
  const [set, setSet] = useState<number | null>(null);
  const [sty, setSty] = useState("");
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => {
    const r = await api<{ limits: { day: string; maxStylist: number | null; maxAssistant: number | null }[] }>(`/api/day-limits?periodId=${periodId}&storeId=${storeId}`).catch(() => null);
    if (r) setSet(days.filter((d) => r.limits.some((l) => l.day === d && l.maxStylist !== null && l.maxAssistant !== null)).length);
  };
  useEffect(() => { load(); }, [periodId, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = set === null ? null : days.length - set;
  return (
    <div className="card" style={{ margin: "8px 0", border: left ? "2px solid #ff9f0a" : undefined }}>
      <b>① 1日に何人まで休めるかを決める（必ず）</b>
      <p className="sub" style={{ margin: "4px 0" }}>希望休を集める前に、すべての日に、スタイリストと、アシスタント（1年目・2年目）の人数を決めてください。スタッフは、この人数をこえても希望休を出せます。あとで調整するときの「目安」として、みんなの画面に出ます。</p>
      <p className="sub" style={{ margin: "4px 0" }}>全部の日を、これだけの人数まで休めるようにします。</p>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 12px", alignItems: "center", margin: "4px 0" }}>
        <b>スタイリスト</b><Stepper label="スタイリストの人数" unit="人" max={99} value={sty} onChange={setSty} />
        <b>アシスタント2年目</b><Stepper label="アシスタント2年目の人数" unit="人" max={99} value={a2} onChange={setA2} />
        <b>アシスタント1年目</b><Stepper label="アシスタント1年目の人数" unit="人" max={99} value={a1} onChange={setA1} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={{ width: "auto", margin: 0 }} disabled={sty === "" || a1 === "" || a2 === ""} onClick={async () => { try { await api("/api/day-limits", { periodId, storeId, days, maxStylist: Number(sty), maxAssistant1: Number(a1), maxAssistant2: Number(a2) }); setMsg("決めました。日ごとに変えたいときは、「見る」のカレンダーで日にちを押してください"); await load(); onChange?.(); } catch (e) { setMsg((e as Error).message); } }}>全部の日に決める</button>
      </div>
      <p className="sub" style={{ margin: "6px 0 0" }}>{left === null ? "" : left === 0 ? "✓ すべての日に決まっています" : `まだ決まっていない日：${left}日`}</p>
      {msg && <p className="sub">{msg}</p>}
    </div>
  );
}
