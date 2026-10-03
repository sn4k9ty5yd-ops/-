"use client";
import { useMemo, useState } from "react";
import { md } from "@/lib/labels";
import { parseOffPaste, type PasteEntry } from "@/lib/shift-paste";
import type { ShiftEntry } from "@/lib/service";

const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();

/** 「休みの人だけ」を書いた文章を貼り付けて、まとめてシフトの休み（公休・有給）にする */
export function PasteOff({ roster, start, end, onApply }: { roster: { id: string; name: string }[]; start: string; end: string; onApply: (entries: ShiftEntry[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseOffPaste(text, roster, start, end, aliases), [text, roster, start, end, aliases]);
  const ready = parsed.entries.filter((e): e is PasteEntry & { personId: string } => !!e.personId);
  const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? "";

  if (!open) return <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setOpen(true)}>休みをまとめて貼り付ける</button>;
  return (
    <div className="card" style={{ marginTop: 8, width: "100%" }}>
      <b>休みの人だけを、まとめて入れる</b>
      <p className="sub">1行に1日。名前は「、」でつなぎます。（有給）を付けると有給、付けなければ公休です。「店休日」と書くと、全員が公休になります。書かなかった人は、そのまま（出勤の予定）です。</p>
      <textarea rows={8} value={text} placeholder={"10/16 金子直樹、渡邊李凰、大田幸奈\n10/17 中嶋翔也（有給）\n10/19 店休日"} onChange={(e) => { setText(e.target.value); setMsg(""); }} style={{ width: "100%", fontSize: 14 }} />
      {parsed.badLines.length > 0 && <p className="err">読めない行（期間 {md(start)}〜{md(end)} の外か、日付がない）：{parsed.badLines.join(" ／ ")}</p>}
      {parsed.unmatched.map((t) => (
        <label key={t}>「{t}」は、だれですか？
          <select value={aliases[norm(t)] ?? ""} onChange={(e) => setAliases({ ...aliases, [norm(t)]: e.target.value })}>
            <option value="">選んでください</option>{roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      ))}
      {ready.length > 0 && (
        <div className="sub" style={{ maxHeight: 180, overflow: "auto" }}>
          {[...new Set(ready.map((e) => e.day))].map((d) => <div key={d}>{md(d)}：{ready.filter((e) => e.day === d).map((e) => `${nameOf(e.personId)}${e.kind === "paid" ? "（有給）" : ""}`).join("、")}</div>)}
        </div>
      )}
      <p className="sub">{ready.length}件を入れます{parsed.unmatched.length ? `（名前が決まっていない ${parsed.entries.length - ready.length} 件は、入れません）` : ""}</p>
      <div className="actions">
        <button disabled={busy || ready.length === 0 || parsed.unmatched.some((t) => !aliases[norm(t)])} style={{ width: "auto" }}
          onClick={async () => {
            setBusy(true);
            try { await onApply(ready.map((e) => ({ membershipId: e.personId, day: e.day, kind: e.kind }))); setMsg(`${ready.length}件を入れました`); setText(""); }
            catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
          }}>入れる</button>
        <button className="ghost" onClick={() => setOpen(false)}>閉じる</button>
      </div>
      {msg && <p className="sub">{msg}</p>}
    </div>
  );
}
