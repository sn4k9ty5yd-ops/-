"use client";
import { useState } from "react";
import { api, useMe } from "@/lib/client";
import { calcHours, DEFAULT_BREAK_RULE, fmt, validateBreakRule, type BreakRule } from "@/lib/hours";

type Tier = { overHours: string; breakMin: string };
const toTiers = (r: BreakRule): Tier[] => r.tiers.map((t) => ({ overHours: String(t.overMinutes / 60), breakMin: String(t.breakMinutes) }));

export default function SettingsPage() {
  const { me } = useMe();
  const canEdit = me.level === 4;
  const [useCap, setUseCap] = useState(me.breakRule.capMinutes !== null);
  const [capHours, setCapHours] = useState(String((me.breakRule.capMinutes ?? 480) / 60));
  const [tiers, setTiers] = useState<Tier[]>(toTiers(me.breakRule));
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState("");

  const rule: BreakRule = {
    capMinutes: useCap ? Math.round(Number(capHours) * 60) : null,
    tiers: tiers.map((t) => ({ overMinutes: Math.round(Number(t.overHours) * 60), breakMinutes: Math.round(Number(t.breakMin)) })),
  };
  const problem = validateBreakRule(rule) ?? (Number.isNaN(rule.capMinutes ?? 0) ? "数字を入れてください" : null);
  const examples = [4, 6, 6.5, 7, 8, 9, 10].map((h) => {
    const r = calcHours("10:00", fmt(600 + h * 60).padStart(5, "0"), rule);
    return { h, ...r };
  });

  return (
    <>
      <h1>設定：休憩と実働のルール</h1>
      <p className="hint">出勤簿・シフトの「休憩」「実働」の自動計算に使います。{canEdit ? "いつでも変更できます。" : "変更できるのは、レベル4（オフィス）だけです。"}</p>
      <div className="card">
        <b>実働の上限</b>
        <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
          <input type="checkbox" style={{ width: 22, height: 22 }} checked={useCap} disabled={!canEdit} onChange={(e) => setUseCap(e.target.checked)} />
          上限を決める（超えた分は休憩として数える）
        </label>
        {useCap && (
          <label style={{ margin: 0 }}>実働は最大 <input type="number" step="0.25" min="1" max="24" style={{ width: 90, display: "inline-block" }} value={capHours} disabled={!canEdit} onChange={(e) => setCapHours(e.target.value)} /> 時間</label>
        )}
      </div>

      <div className="card">
        <b>休憩の段階</b>
        <p className="sub" style={{ margin: "4px 0 10px" }}>「在店が〇時間を超えたら、休憩を〇分にする」を、いくつでも追加できます。何も無ければ、休憩は上限を超えた分だけです。</p>
        {tiers.map((t, i) => (
          <div key={i} className="tierrow">
            <span>在店が</span>
            <input type="number" step="0.25" min="0" max="24" value={t.overHours} disabled={!canEdit} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, overHours: e.target.value } : x)))} />
            <span>時間を超えたら 休憩</span>
            <input type="number" step="5" min="0" max="480" value={t.breakMin} disabled={!canEdit} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, breakMin: e.target.value } : x)))} />
            <span>分</span>
            {canEdit && <button className="ghost" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>削除</button>}
          </div>
        ))}
        {canEdit && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => setTiers([...tiers, { overHours: "6", breakMin: "45" }])}>＋ 段階を追加</button>}
      </div>

      <div className="card">
        <b>こうなります（10:00 に入店した場合）</b>
        <table className="ex"><thead><tr><th>在店</th><th>休憩</th><th>実働</th></tr></thead>
          <tbody>{examples.map((e) => <tr key={e.h}><td>{fmt(e.stay)}</td><td>{fmt(e.breakMin)}</td><td>{fmt(e.work)}</td></tr>)}</tbody></table>
      </div>

      {problem && <p className="err">{problem}</p>}
      {canEdit && (
        <div className="actions">
          <button style={{ flex: 1 }} disabled={!!problem} onClick={async () => {
            try { await api("/api/settings", { breakRule: rule }); setMsg(""); setSaved("保存しました。これから計算する分に使われます。"); } catch (e) { setSaved(""); setMsg((e as Error).message); }
          }}>保存する</button>
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => { setUseCap(true); setCapHours("8"); setTiers(toTiers(DEFAULT_BREAK_RULE)); }}>初期設定に戻す</button>
        </div>
      )}
      {saved && <p className="hint">{saved}</p>}
      {msg && <p className="err">{msg}</p>}
      {canEdit && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>バックアップ</b>
          <p className="sub" style={{ margin: "4px 0 8px" }}>すべてのデータ（シフト・出勤簿・有給・商品・棚卸し・在庫など）を、1つのファイルにしてダウンロードします。月に1回くらい、保管しておくと安心です。個人情報を含むので、安全な場所に保管してください（パスコードは含まれません）。</p>
          <button className="ghost" style={{ color: "var(--blue)", width: "auto" }} onClick={async () => {
            try {
              const res = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
              if (!res.ok) throw new Error((await res.json()).error ?? "ダウンロードできませんでした");
              const blob = await res.blob(); const a = document.createElement("a");
              a.href = URL.createObjectURL(blob); a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "album-backup.json"; a.click(); URL.revokeObjectURL(a.href);
              setSaved("バックアップをダウンロードしました。");
            } catch (e) { setMsg((e as Error).message); }
          }}>バックアップをダウンロード</button>
        </div>
      )}
      <p className="hint">初期設定：実働は最大8時間。8時間以内は休憩なし、8時間を超えた分が休憩（10〜19時なら休憩1時間）。すでに保存した出勤簿の休憩は、自動では変わりません。</p>
    </>
  );
}
