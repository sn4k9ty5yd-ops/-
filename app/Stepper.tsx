"use client";
import { useEffect, useRef } from "react";

/**
 * 数字を打ちこまず、矢印（− ＋）で増やしたり減らしたりする入力。
 * 押しつづけると、だんだん速く動く。値は文字（"" = 未入力）で受け渡しする。
 */
export function Stepper({ value, onChange, step = 1, bigStep, min = 0, max = 999999, disabled, label, placeholder, unit, width, clearable, decimals = 0, className, onCommit }: {
  value: string | number; onChange: (v: string) => void; step?: number; bigStep?: number; min?: number; max?: number; disabled?: boolean;
  label?: string; placeholder?: string; unit?: string; width?: number; clearable?: boolean; decimals?: number; className?: string; onCommit?: (v: string) => void;
}) {
  const cur = useRef(value); cur.current = value;
  const cb = useRef(onChange); cb.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);
  const commitT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit); commit.current = onCommit;
  const stop = () => { if (timer.current) clearTimeout(timer.current); if (loop.current) clearInterval(loop.current); timer.current = null; loop.current = null; };
  useEffect(() => stop, []);
  const fmt = (n: number) => String(decimals ? Number(n.toFixed(decimals)) : Math.round(n));
  const apply = (d: number) => {
    const raw = cur.current === "" || cur.current == null ? NaN : Number(cur.current);
    const next = Math.min(max, Math.max(min, Number.isFinite(raw) ? raw + d : (d > 0 ? Math.max(min, d) : min)));
    cur.current = fmt(next); cb.current(fmt(next));
    if (commit.current) { if (commitT.current) clearTimeout(commitT.current); const v = fmt(next); commitT.current = setTimeout(() => commit.current?.(v), 700); }
  };
  const press = (d: number) => (e: React.PointerEvent) => {
    if (disabled) return; e.preventDefault(); stop(); apply(d);
    timer.current = setTimeout(() => { let n = 0; loop.current = setInterval(() => { n++; apply(n > 30 ? d * 20 : n > 12 ? d * 5 : d); }, 90); }, 450);
  };
  const empty = value === "" || value == null;
  const Btn = ({ d, children, big, aria }: { d: number; children: React.ReactNode; big?: boolean; aria: string }) => (
    <button type="button" className={`stp-b ${big ? "big" : ""}`} disabled={disabled} aria-label={aria} onPointerDown={press(d)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={(e) => e.preventDefault()}>{children}</button>
  );
  return (
    <span className={`stp ${className ?? ""}`} style={width ? { width } : undefined} role="group" aria-label={label}>
      {bigStep ? <Btn d={-bigStep} big aria={`${label ?? ""}を${bigStep}減らす`}>−{bigStep >= 1000 ? `${bigStep / 1000}千` : bigStep}</Btn> : null}
      <Btn d={-step} aria={`${label ?? ""}を減らす`}>−</Btn>
      <span className={`stp-v ${empty ? "ph" : ""}`} aria-live="polite">{empty ? (placeholder ?? "—") : String(value)}{!empty && unit ? <small>{unit}</small> : null}</span>
      <Btn d={step} aria={`${label ?? ""}を増やす`}>＋</Btn>
      {bigStep ? <Btn d={bigStep} big aria={`${label ?? ""}を${bigStep}増やす`}>＋{bigStep >= 1000 ? `${bigStep / 1000}千` : bigStep}</Btn> : null}
      {clearable && !empty && !disabled ? <button type="button" className="stp-x" aria-label="空にもどす" onClick={() => { onChange(""); onCommit?.(""); }}>✕</button> : null}
    </span>
  );
}
