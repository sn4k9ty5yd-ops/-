"use client";
import { useEffect, useState } from "react";
import { Stepper } from "@/app/Stepper";
import { api } from "@/lib/client";

/** 期間のすべての日に、休みの上限をまとめて決める（日ごとの変更は、シフト画面で日にちを押します） */
export function LimitAll({ periodId, storeId, days, onDone }: { periodId: string; storeId: string; days: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [msg, setMsg] = useState("");
  if (!open) return <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setOpen(true)}>休みの上限をまとめて決める</button>;
  return (
    <div className="card" style={{ marginTop: 8, width: "100%" }}>
      <b>休みの上限（1日に休める人数）</b>
      <p className="sub">希望休は、上限に関係なく、みんな自由に出せます。ここで決めた人数を超えた日は、シフトの日付に「⚠」が出て、確定の前に、かぶっている人へ知らせて話し合えます。日ごとに変えたいときは、シフト画面で日にちを押してください。</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>この期間の全部の日を</span>
        <Stepper label="休める人数の上限" unit="人" max={99} value={v} onChange={setV} />
        <span>人までにする</span>
        <button style={{ width: "auto", margin: 0 }} disabled={v === ""} onClick={async () => { try { const r = await api<{ count: number }>("/api/day-limits", { periodId, storeId, days, maxOff: Number(v) }); setMsg(`${r.count}日に決めました`); onDone(); } catch (e) { setMsg((e as Error).message); } }}>決める</button>
        <button className="ghost" style={{ width: "auto", margin: 0 }} onClick={async () => { try { await api("/api/day-limits", { periodId, storeId, days, maxOff: null }); setMsg("すべての上限をなくしました"); onDone(); } catch (e) { setMsg((e as Error).message); } }}>全部なしにする</button>
      </div>
      {msg && <p className="sub">{msg}</p>}
      <button className="ghost" style={{ color: "var(--sub)" }} onClick={() => setOpen(false)}>閉じる</button>
    </div>
  );
}

/** 希望休を集める前に必ず決める「1日に何人まで休めるか」。スタッフは上限をこえても出せる（目安） */
export function LimitRequired({ periodId, storeId, days, onChange }: { periodId: string; storeId: string; days: string[]; onChange?: () => void }) {
  const [set, setSet] = useState<number | null>(null);
  const [v, setV] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => {
    const r = await api<{ limits: { day: string }[] }>(`/api/day-limits?periodId=${periodId}&storeId=${storeId}`).catch(() => null);
    if (r) setSet(days.filter((d) => r.limits.some((l) => l.day === d)).length);
  };
  useEffect(() => { load(); }, [periodId, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = set === null ? null : days.length - set;
  return (
    <div className="card" style={{ margin: "8px 0", border: left ? "2px solid #ff9f0a" : undefined }}>
      <b>① 1日に何人まで休めるかを決める（必ず）</b>
      <p className="sub" style={{ margin: "4px 0" }}>希望休を集める前に、すべての日に決めてください。スタッフは、この人数をこえても希望休を出せます。あとで調整するときの「目安」として、みんなの画面に出ます。</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>全部の日を</span>
        <Stepper label="休める人数" unit="人" max={99} value={v} onChange={setV} />
        <span>人までにする</span>
        <button style={{ width: "auto", margin: 0 }} disabled={v === ""} onClick={async () => { try { await api("/api/day-limits", { periodId, storeId, days, maxOff: Number(v) }); setMsg("決めました。日ごとに変えたいときは、「見る」のカレンダーで日にちを押してください"); await load(); onChange?.(); } catch (e) { setMsg((e as Error).message); } }}>決める</button>
      </div>
      <p className="sub" style={{ margin: "6px 0 0" }}>{left === null ? "" : left === 0 ? "✓ すべての日に決まっています" : `まだ決まっていない日：${left}日`}</p>
      {msg && <p className="sub">{msg}</p>}
    </div>
  );
}
