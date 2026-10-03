"use client";
import { useState } from "react";
import { upcomingPeriods } from "@/lib/periods";

const RULES = [
  { value: 16, label: "16日〜翌月15日（いまの会社）" },
  { value: 1, label: "1日〜月末" },
  { value: 21, label: "21日〜翌月20日" },
];

export default function PeriodsPage() {
  const [startDay, setStartDay] = useState(16);
  const today = new Date().toISOString().slice(0, 10);
  const list = upcomingPeriods(today, startDay, 6);
  return (
    <>
      <h1>シフト期間</h1>
      <label htmlFor="rule">締め日のルール</label>
      <select id="rule" value={startDay} onChange={(e) => setStartDay(Number(e.target.value))}>
        {RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <ul className="list">
        {list.map((p, i) => (
          <li key={p.start}>
            <div><b>{p.label}</b> {i === 0 && <span className="chip">いまの期間</span>}
              <div className="sub">{p.start} 〜 {p.end}</div></div>
          </li>
        ))}
      </ul>
      <p className="hint">希望休の受付開始・締切・確定の日付設定は、次の段階で追加します。</p>
    </>
  );
}
