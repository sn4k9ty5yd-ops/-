"use client";
import { useState } from "react";
import { Stepper } from "@/app/Stepper";
import { api } from "@/lib/client";
import type { StaffRow } from "@/lib/service";

type Stint = { storeId: string; fromDay: number; toDay: number };

/** 「カレンダーだけの人」（社長・役員など）: 出勤簿には入れず、シフトのカレンダーにだけ名前を出す。出勤するお店と、月の日付の範囲を決める */
export function CalendarMember({ s, stores, run }: { s: StaffRow; stores: { id: string; name: string }[]; run: (fn: () => Promise<void>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Stint[]>(s.stints?.length ? s.stints : [{ storeId: s.storeId, fromDay: 1, toDay: 31 }]);
  const name = (id: string) => stores.find((x) => x.id === id)?.name ?? "";
  const save = (on: boolean) => run(async () => { await api(`/api/staff/${s.id}/calendar`, { on, stints: on ? list : [] }); setOpen(false); });
  const set = (i: number, patch: Partial<Stint>) => setList((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ width: "100%" }}>
      {s.calendarOnly && <div className="sub" style={{ marginTop: 2 }}>📅 カレンダーだけの人（出勤簿には入りません）：{(s.stints ?? []).map((t) => `${name(t.storeId)} ${t.fromDay}〜${t.toDay}日`).join("／")}</div>}
      {!open ? (
        <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setOpen(true)}>{s.calendarOnly ? "カレンダーだけの人：出勤するお店・日にちを直す" : "カレンダーだけの人にする"}</button>
      ) : (
        <div className="card" style={{ margin: "6px 0" }}>
          <b>出勤するお店と、月の日にち</b>
          <p className="sub" style={{ margin: "4px 0" }}>例：「16〜31日は天神店、1〜15日はオルガン」なら、2行入れます。ここで決めたお店のシフトのカレンダーに、休みでない日は「出勤」として出ます。出勤簿（入店・退店の表）には出ません。</p>
          {list.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6, margin: "8px 0", paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
              <select aria-label="お店" value={t.storeId} onChange={(e) => set(i, { storeId: e.target.value })}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Stepper label="はじまりの日" unit="日から" min={1} max={31} value={String(t.fromDay)} onChange={(v) => set(i, { fromDay: Number(v) || 1 })} />
                <Stepper label="おわりの日" unit="日まで" min={1} max={31} value={String(t.toDay)} onChange={(v) => set(i, { toDay: Number(v) || 31 })} />
                {list.length > 1 && <button className="ghost" style={{ width: "auto", margin: 0 }} onClick={() => setList((v) => v.filter((_, j) => j !== i))}>この行を消す</button>}
              </div>
            </div>
          ))}
          <button className="ghost" style={{ width: "auto" }} onClick={() => setList((v) => [...v, { storeId: stores[0]?.id ?? "", fromDay: 1, toDay: 31 }])}>＋ お店と日にちを足す</button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button style={{ width: "auto", margin: 0 }} onClick={() => save(true)}>保存</button>
            {s.calendarOnly && <button className="ghost" style={{ width: "auto", margin: 0, color: "#d70015" }} onClick={() => confirm("ふつうの人（出勤簿に入る人）にもどしますか？") && save(false)}>ふつうの人にもどす</button>}
            <button className="ghost" style={{ width: "auto", margin: 0 }} onClick={() => setOpen(false)}>やめる</button>
          </div>
        </div>
      )}
    </div>
  );
}
