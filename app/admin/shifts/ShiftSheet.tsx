"use client";
import { useState } from "react";
import { useMe } from "@/lib/client";
import { calcHours, fmt } from "@/lib/hours";
import { KIND_BUTTONS } from "@/lib/shift-ui";
import type { ShiftEntry, ShiftKind, ShiftRow } from "@/lib/service";

/** 1人・1日（または複数日）のシフトを入力する下から出る入力欄 */
export function ShiftSheet({
  title, sub, initial, defaults, onSave, onClear, onClose,
}: {
  title: string; sub?: string; initial?: ShiftRow; defaults: { start: string; end: string };
  onSave(e: Pick<ShiftEntry, "kind" | "start" | "end" | "breakMin">): Promise<void>; onClear?: () => Promise<void>; onClose(): void;
}) {
  const { me } = useMe();
  const [kind, setKind] = useState<ShiftKind>(initial?.kind ?? "work");
  const [start, setStart] = useState(initial?.start ?? defaults.start);
  const [end, setEnd] = useState(initial?.end ?? defaults.end);
  const [brk, setBrk] = useState<string>(initial?.breakMin == null ? "" : String(initial.breakMin));   // 空=自動
  const [brkTouched, setBrkTouched] = useState(false);
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
              <label>入店<input type="time" step={300} value={start} onChange={(e) => { setStart(e.target.value); if (!brkTouched) setBrk(""); }} /></label>
              <label>退店<input type="time" step={300} value={end} onChange={(e) => { setEnd(e.target.value); if (!brkTouched) setBrk(""); }} /></label>
            </div>
            {(() => {
              const ok = start && end && end > start; const a = ok ? calcHours(start, end, me.breakRule) : null;
              const bm = brk === "" ? a?.breakMin ?? 0 : Number(brk);
              return (
                <>
                  <label style={{ display: "block", margin: "8px 0 0" }}>休憩（分）
                    <input type="number" inputMode="numeric" min={0} max={600} step={5} value={brk} placeholder={a ? `自動：${a.breakMin}分` : "自動"} onChange={(e) => { setBrkTouched(true); setBrk(e.target.value); }} />
                  </label>
                  <div className="sub" style={{ margin: "6px 0" }}>{a ? `在店 ${fmt(a.stay)}　休憩 ${fmt(Math.min(a.stay, bm))}${brk === "" ? "（自動）" : ""}　実働 ${fmt(Math.max(0, a.stay - bm))}` : ""}　空のままなら、設定の休憩ルールで自動になります</div>
                </>
              );
            })()}
          </>
        )}
        {err && <p className="err">{err}</p>}
        <button disabled={busy} onClick={() => go(() => onSave({ kind, start: kind === "work" ? start : null, end: kind === "work" ? end : null, breakMin: kind === "work" && brk !== "" ? Math.round(Number(brk)) : null }))}>保存</button>
        <div className="actions" style={{ marginTop: 8, justifyContent: "space-between" }}>
          {onClear && initial ? <button className="ghost" disabled={busy} onClick={() => go(onClear)}>この日を消す</button> : <span />}
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
