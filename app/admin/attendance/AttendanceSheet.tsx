"use client";
import { useState } from "react";
import { useMe } from "@/lib/client";
import { calcHours, fmt } from "@/lib/hours";
import { KIND_BUTTONS } from "@/lib/shift-ui";
import type { AttendanceEntry, AttendanceRow, ShiftKind } from "@/lib/service";

/** 出勤簿の1人・1日の入力欄。休憩は自動計算（会社のルール）。手で変えることもできる */
export function AttendanceSheet({
  title, initial, defaults, onSave, onClear, onClose,
}: {
  title: string; initial?: AttendanceRow; defaults: { start: string; end: string };
  onSave(e: Pick<AttendanceEntry, "kind" | "clockIn" | "clockOut" | "breakMin" | "note">): Promise<void>; onClear?: () => Promise<void>; onClose(): void;
}) {
  const { me } = useMe();
  const [kind, setKind] = useState<ShiftKind>(initial?.kind ?? "work");
  const [start, setStart] = useState(initial?.clockIn ?? defaults.start);
  const [end, setEnd] = useState(initial?.clockOut ?? defaults.end);
  const [manual, setManual] = useState(!!initial && initial.kind === "work" && initial.breakMin !== calcHours(initial.clockIn!, initial.clockOut!, me.breakRule).breakMin);
  const [brk, setBrk] = useState(String(initial?.breakMin ?? 0));
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const auto = start && end && end > start ? calcHours(start, end, me.breakRule) : null;
  const breakMin = manual ? Number(brk) : auto?.breakMin ?? 0;
  const workMin = auto ? Math.max(0, auto.stay - breakMin) : 0;
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); onClose(); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <b style={{ fontSize: 18 }}>{title}</b>
        <div className="seg">{KIND_BUTTONS.map((k) => <button key={k.kind} className={kind === k.kind ? "on" : ""} onClick={() => setKind(k.kind)}>{k.label}</button>)}</div>
        {kind === "work" && (
          <>
            <div className="times">
              <label>入店<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label>退店<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0 4px" }}>
              <input type="checkbox" style={{ width: 20, height: 20 }} checked={manual} onChange={(e) => { setManual(e.target.checked); if (e.target.checked && auto) setBrk(String(auto.breakMin)); }} />
              休憩を手で決める
            </label>
            {manual && <label style={{ margin: 0 }}>休憩（分）<input type="number" min="0" step="5" value={brk} onChange={(e) => setBrk(e.target.value)} /></label>}
            <div className="sub" style={{ margin: "8px 0" }}>{auto ? `在店 ${fmt(auto.stay)}　休憩 ${fmt(breakMin)}${manual ? "" : "（自動）"}　実働 ${fmt(workMin)}` : ""}</div>
          </>
        )}
        <label style={{ margin: "8px 0 0" }}>メモ（早退の理由など）<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：早退（子どもの体調不良）" /></label>
        {err && <p className="err">{err}</p>}
        <button disabled={busy} onClick={() => go(() => onSave({ kind, clockIn: kind === "work" ? start : null, clockOut: kind === "work" ? end : null, breakMin: kind === "work" && manual ? Number(brk) : undefined, note }))}>保存</button>
        <div className="actions" style={{ marginTop: 8, justifyContent: "space-between" }}>
          {onClear && initial ? <button className="ghost" disabled={busy} onClick={() => go(onClear)}>この日を消す</button> : <span />}
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
