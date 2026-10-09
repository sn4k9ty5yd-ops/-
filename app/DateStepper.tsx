"use client";
import { Stepper } from "./Stepper";

/** 日付を打たずに、矢印で年（令和）・月・日を動かす。値は "YYYY-MM-DD" */
export function DateStepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const y = m ? Number(m[1]) : new Date().getFullYear(), mo = m ? Number(m[2]) : 1, d = m ? Number(m[3]) : 1;
  const set = (ny: number, nm: number, nd: number) => {
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    onChange(`${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(nd, last)).padStart(2, "0")}`);
  };
  return (
    <span className="dstep" role="group" aria-label={label ?? "日付"} style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>令和<Stepper label="年" unit="年" min={1} max={99} value={String(y - 2018)} onChange={(v) => set(Number(v) + 2018, mo, d)} /></span>
      <Stepper label="月" unit="月" min={1} max={12} value={String(mo)} onChange={(v) => set(y, Number(v), d)} />
      <Stepper label="日" unit="日" min={1} max={31} value={String(d)} onChange={(v) => set(y, mo, Number(v))} />
    </span>
  );
}
