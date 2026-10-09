"use client";
import { useState } from "react";
import { DateStepper } from "./DateStepper";

const reiwa = (y: number) => `令和${y - 2018}年`;
const jst = () => new Date(Date.now() + 9 * 3600e3).getUTCFullYear();

/** 年を、矢印で前後に動かして選ぶ。まんなかが選んでいる年（今年なら「今年」の印）。日にちは、ふつう10月31日で、必要なときだけ変えられる */
export function YearSwitch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [more, setMore] = useState(false);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const y = m ? Number(m[1]) : jst(), mo = m ? m[2] : "10", d = m ? m[3] : "31";
  const go = (ny: number) => { const last = new Date(Date.UTC(ny, Number(mo), 0)).getUTCDate(); onChange(`${ny}-${mo}-${String(Math.min(Number(d), last)).padStart(2, "0")}`); };
  const tag = y === jst() ? "今年" : y === jst() - 1 ? "昨年" : y === jst() + 1 ? "来年" : "";
  return (
    <div className="yswitch" role="group" aria-label={label ?? "年"}>
      <div className="yrow">
        <button type="button" className="yarrow" aria-label="前の年へ" onClick={() => go(y - 1)}>‹</button>
        <button type="button" className="yside" onClick={() => go(y - 1)}>{reiwa(y - 1)}</button>
        <div className="ymid"><small>{tag || "　"}</small><b>{reiwa(y)}</b></div>
        <button type="button" className="yside" onClick={() => go(y + 1)}>{reiwa(y + 1)}</button>
        <button type="button" className="yarrow" aria-label="次の年へ" onClick={() => go(y + 1)}>›</button>
      </div>
      <p className="sub" style={{ margin: "6px 0 0", textAlign: "center" }}>棚卸日：<b>{reiwa(y)}{Number(mo)}月{Number(d)}日</b>　<button type="button" className="ghost" style={{ padding: "0 6px", width: "auto", margin: 0, fontSize: 12 }} onClick={() => setMore(!more)}>{more ? "閉じる" : "日にちを変える"}</button></p>
      {more && <div style={{ marginTop: 6, textAlign: "center" }}><DateStepper label="棚卸日" value={value} onChange={onChange} /></div>}
    </div>
  );
}
