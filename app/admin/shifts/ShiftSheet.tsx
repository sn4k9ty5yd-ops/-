"use client";
import { useState } from "react";
import { hoursText, KIND_BUTTONS } from "@/lib/shift-ui";
import type { ShiftEntry, ShiftKind, ShiftRow } from "@/lib/service";

/** 1人・1日（または複数日）のシフトを入力する下から出る入力欄 */
export function ShiftSheet({
  title, sub, initial, defaults, onSave, onClear, onClose,
}: {
  title: string; sub?: string; initial?: ShiftRow; defaults: { start: string; end: string };
  onSave(e: Pick<ShiftEntry, "kind" | "start" | "end">): Promise<void>; onClear?: () => Promise<void>; onClose(): void;
}) {
  const [kind, setKind] = useState<ShiftKind>(initial?.kind ?? "work");
  const [start, setStart] = useState(initial?.start ?? defaults.start);
  const [end, setEnd] = useState(initial?.end ?? defaults.end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); onClose(); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <b style={{ fontSize: 18 }}>{title}</b>
        {sub && <div className="sub">{sub}</div>}
        <div className="seg">
          {KIND_BUTTONS.map((k) => <button key={k.kind} className={kind === k.kind ? "on" : ""} onClick={() => setKind(k.kind)}>{k.label}</button>)}
        </div>
        {kind === "work" && (
          <>
            <div className="times">
              <label>入店<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label>退店<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            <div className="sub" style={{ margin: "6px 0" }}>{hoursText(start, end)}</div>
          </>
        )}
        {err && <p className="err">{err}</p>}
        <button disabled={busy} onClick={() => go(() => onSave({ kind, start: kind === "work" ? start : null, end: kind === "work" ? end : null }))}>保存</button>
        <div className="actions" style={{ marginTop: 8, justifyContent: "space-between" }}>
          {onClear && initial ? <button className="ghost" disabled={busy} onClick={() => go(onClear)}>この日を消す</button> : <span />}
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
