"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { isPassed, maxMismatch, nextAttemptNo, SCORE_CHOICES, SCORE_HINT, sheetStatus, totalOfScores } from "@/lib/lesson-check";
import type { CheckAttempt, CheckData, CheckSheet } from "@/lib/service";

const bg = { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" } as const;
const box = { background: "var(--card, #fff)", width: "100%", maxWidth: 760, maxHeight: "92vh", overflow: "auto", borderRadius: "18px 18px 0 0", padding: 16 } as const;

function Page() {
  const { me } = useMe();
  const [trainee, setTrainee] = useState<string>("");
  const [data, setData] = useState<CheckData | null>(null);
  const [grade, setGrade] = useState("1年目");
  const [open, setOpen] = useState<string | null>(null);
  const [score, setScore] = useState<{ sheet: CheckSheet; no: number } | null>(null);
  const [edit, setEdit] = useState<CheckSheet | "new" | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<CheckData>(`/api/lesson-check${trainee ? `?trainee=${trainee}` : ""}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [trainee]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const grades = useMemo(() => Array.from(new Set((data?.sheets ?? []).filter((s) => s.active).map((s) => s.grade))), [data]);
  if (!data) return <main><Link href="/home" className="back">← ホーム</Link><h1>レッスンチェック</h1>{msg && <p className="err">{msg}</p>}</main>;
  const sheets = data.sheets.filter((s) => s.active && s.grade === grade);
  const mine = data.trainee?.id === me.id;
  const attOf = (id: string) => data.attempts.filter((a) => a.sheetId === id);
  const canScore = data.canAssess && !mine;

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>レッスンチェック</h1>
      <p className="sub">技術のチェック表です。項目ごとに5点満点で採点し、合計が合格点以上なら合格です。何回でも受け直せます。</p>
      {msg && <p className="err">{msg}</p>}
      {data.trainees.length > 0 && (
        <select value={trainee || me.id} onChange={(e) => setTrainee(e.target.value === me.id ? "" : e.target.value)} style={{ marginBottom: 10 }}>
          <option value={me.id}>自分</option>
          {data.trainees.filter((t) => t.id !== me.id).map((t) => <option key={t.id} value={t.id}>{t.storeName}　{t.name}{t.rank === "assistant" ? "（アシスタント）" : ""}</option>)}
        </select>
      )}
      {data.trainee ? <h2>{data.trainee.name} さん</h2> : <p className="hint">この人の採点は見られません。</p>}
      <div className="toolbar">
        {grades.map((g) => <button key={g} className={g === grade ? "" : "ghost"} onClick={() => setGrade(g)}>{g}</button>)}
        {data.canEditSheets && <button className="ghost" onClick={() => setEdit("new")}>＋ 表を足す</button>}
      </div>
      <div className="grid2">
        {sheets.map((s) => {
          const at = attOf(s.id); const st = sheetStatus(s, at);
          return (
            <div key={s.id} className="card" style={{ cursor: "pointer" }} onClick={() => setOpen(s.id)}>
              <b>{s.name}</b>
              <p className="sub" style={{ margin: "4px 0" }}>{s.maxPoints}点満点・合格 {s.passPoints}点・{s.maxAttempts}回まで</p>
              {st.passedAt ? <span className="chip" style={{ color: "var(--ok)" }}>✅ {st.passedAt}回目で合格</span>
                : st.count ? <span className="chip">{st.count}回 ／ 最高 {st.best}点</span> : <span className="chip">まだ</span>}
            </div>
          );
        })}
      </div>

      {open && (() => {
        const s = data.sheets.find((x) => x.id === open)!; const items = s.items.filter((i) => i.active); const at = attOf(s.id);
        const cols = Math.max(s.maxAttempts, 1);
        const warn = maxMismatch(s);
        return (
          <div style={bg} onClick={() => setOpen(null)}><div style={box} onClick={(e) => e.stopPropagation()}>
            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{s.name}</h2>
              <span>{data.canEditSheets && <button className="ghost" onClick={() => { setOpen(null); setEdit(s); }}>採点表を編集</button>} <button className="ghost" onClick={() => setOpen(null)}>閉じる</button></span>
            </div>
            {s.memo && <p className="sub" style={{ whiteSpace: "pre-wrap" }}>{s.memo}</p>}
            {warn && data.canEditSheets && <p className="hint">⚠ {warn}</p>}
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th style={{ position: "sticky", left: 0, background: "inherit" }}>項目</th>{Array.from({ length: cols }, (_, i) => <th key={i}>{i + 1}回</th>)}</tr></thead>
                <tbody>
                  {items.map((it) => <tr key={it.id}><td style={{ position: "sticky", left: 0, background: "inherit", minWidth: 120 }}>{it.name}</td>
                    {Array.from({ length: cols }, (_, i) => { const a = at.find((x) => x.attemptNo === i + 1); return <td key={i} style={{ textAlign: "center" }}>{a ? (a.scores[it.id] ?? "－") : ""}</td>; })}</tr>)}
                  <tr><td style={{ position: "sticky", left: 0, background: "inherit" }}><b>合計</b></td>{Array.from({ length: cols }, (_, i) => { const a = at.find((x) => x.attemptNo === i + 1); return <td key={i} style={{ textAlign: "center" }}>{a ? <b>{a.total}</b> : ""}</td>; })}</tr>
                  <tr><td style={{ position: "sticky", left: 0, background: "inherit" }}>合否</td>{Array.from({ length: cols }, (_, i) => { const a = at.find((x) => x.attemptNo === i + 1); return <td key={i} style={{ textAlign: "center" }}>{a ? (isPassed(a.total, s.passPoints) ? "合格" : "—") : ""}</td>; })}</tr>
                  <tr><td style={{ position: "sticky", left: 0, background: "inherit" }}>査定者</td>{Array.from({ length: cols }, (_, i) => <td key={i} className="sub">{at.find((x) => x.attemptNo === i + 1)?.assessorName ?? ""}</td>)}</tr>
                  <tr><td style={{ position: "sticky", left: 0, background: "inherit" }}>タイム</td>{Array.from({ length: cols }, (_, i) => <td key={i} className="sub">{at.find((x) => x.attemptNo === i + 1)?.time ?? ""}</td>)}</tr>
                  {canScore && <tr><td style={{ position: "sticky", left: 0, background: "inherit" }}></td>{Array.from({ length: cols }, (_, i) => <td key={i} style={{ textAlign: "center" }}><button className="ghost" onClick={() => setScore({ sheet: s, no: i + 1 })}>{at.some((x) => x.attemptNo === i + 1) ? "直す" : "採点"}</button></td>)}</tr>}
                </tbody>
              </table>
            </div>
            {at.filter((a) => a.comment).map((a) => <p key={a.id} className="sub"><b>{a.attemptNo}回目</b>：{a.comment}</p>)}
            {canScore && nextAttemptNo(s, at) && <button onClick={() => setScore({ sheet: s, no: nextAttemptNo(s, at)! })}>次の回（{nextAttemptNo(s, at)}回目）を採点する</button>}
          </div></div>
        );
      })()}

      {score && data.trainee && <ScoreSheet sheet={score.sheet} no={score.no} traineeId={data.trainee.id} traineeName={data.trainee.name}
        existing={attOf(score.sheet.id).find((a) => a.attemptNo === score.no)} onClose={() => setScore(null)} onDone={() => { setScore(null); load(); }} />}
      {edit && <SheetEditor sheet={edit === "new" ? null : edit} grade={grade} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </main>
  );
}

function ScoreSheet({ sheet, no, traineeId, traineeName, existing, onClose, onDone }: { sheet: CheckSheet; no: number; traineeId: string; traineeName: string; existing?: CheckAttempt; onClose: () => void; onDone: () => void }) {
  const items = sheet.items.filter((i) => i.active);
  const [sc, setSc] = useState<Record<string, number>>(existing?.scores ?? {});
  const [time, setTime] = useState(existing?.time ?? "");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const total = totalOfScores(sc, items.map((i) => i.id));
  const filled = items.every((i) => sc[i.id] !== undefined);
  const run = async (body: object) => { setBusy(true); try { await api("/api/lesson-check", { method: "POST", body: JSON.stringify(body) }); onDone(); } catch (e) { setMsg((e as Error).message); setBusy(false); } };
  return (
    <div style={{ ...bg, zIndex: 60 }} onClick={onClose}><div style={box} onClick={(e) => e.stopPropagation()}>
      <h2 style={{ marginTop: 0 }}>{sheet.name}　{no}回目</h2>
      <p className="sub">{traineeName} さん</p>
      {items.map((it) => (
        <div key={it.id} style={{ margin: "10px 0" }}>
          <div>{it.name}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SCORE_CHOICES.map((n) => <button key={n} className={sc[it.id] === n ? "" : "ghost"} title={SCORE_HINT[n]} onClick={() => setSc({ ...sc, [it.id]: n })} style={{ minWidth: 44 }}>{n}</button>)}
          </div>
        </div>
      ))}
      <p className="sub">5 とてもよい ／ 4 よい ／ 3 ふつう ／ 2 もう少し ／ 1 できていない ／ 0 やっていない</p>
      <input placeholder="タイム（例 4:30）" value={time} onChange={(e) => setTime(e.target.value)} style={{ marginBottom: 6 }} />
      <textarea placeholder="コメント（任意）" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
      <p><b style={{ fontSize: 20 }}>合計 {total}点</b> ／ 合格 {sheet.passPoints}点　{filled ? (isPassed(total, sheet.passPoints) ? "✅ 合格" : "もう少し") : "（まだ入っていない項目があります）"}</p>
      {msg && <p className="err">{msg}</p>}
      <div className="toolbar">
        <button disabled={busy || !filled} onClick={() => run({ action: "attempt", sheetId: sheet.id, traineeId, attemptNo: no, time, comment, scores: items.map((i) => ({ itemId: i.id, score: sc[i.id] })) })}>保存</button>
        {existing && <button className="ghost" disabled={busy} onClick={() => confirm("この回の採点を取り消しますか？") && run({ action: "delete", attemptId: existing.id })}>取り消す</button>}
        <button className="ghost" onClick={onClose}>やめる</button>
      </div>
    </div></div>
  );
}

function SheetEditor({ sheet, grade, onClose, onDone }: { sheet: CheckSheet | null; grade: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ grade: sheet?.grade ?? grade, name: sheet?.name ?? "", memo: sheet?.memo ?? "", maxPoints: sheet?.maxPoints ?? 25, passPoints: sheet?.passPoints ?? 20, maxAttempts: sheet?.maxAttempts ?? 10, active: sheet?.active ?? true });
  const [items, setItems] = useState<{ id?: string; name: string }[]>((sheet?.items.filter((i) => i.active) ?? []).map((i) => ({ id: i.id, name: i.name })));
  const [msg, setMsg] = useState("");
  const num = (k: "maxPoints" | "passPoints" | "maxAttempts") => <input type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />;
  const warn = maxMismatch({ ...f, items: items.map((i) => ({ id: i.id ?? "", active: true })) });
  const save = async () => { try { await api("/api/lesson-check", { method: "POST", body: JSON.stringify({ action: "sheet", id: sheet?.id, ...f, items: items.filter((i) => i.name.trim()) }) }); onDone(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div style={{ ...bg, zIndex: 60 }} onClick={onClose}><div style={box} onClick={(e) => e.stopPropagation()}>
      <h2 style={{ marginTop: 0 }}>{sheet ? "採点表を編集" : "採点表を足す"}</h2>
      <label>学年（1年目・2年目など）<input value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} /></label>
      <label>名前<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>メモ（制限時間など）<textarea rows={3} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></label>
      <div className="grid2"><label>満点{num("maxPoints")}</label><label>合格点{num("passPoints")}</label><label>回数{num("maxAttempts")}</label></div>
      {warn && <p className="hint">⚠ {warn}</p>}
      <h3>項目</h3>
      {items.map((it, i) => (
        <div key={i} className="toolbar">
          <input value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <button className="ghost" disabled={i === 0} onClick={() => { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setItems(a); }}>↑</button>
          <button className="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>消す</button>
        </div>
      ))}
      <button className="ghost" onClick={() => setItems([...items, { name: "" }])}>＋ 項目を足す</button>
      <label style={{ display: "block", marginTop: 10 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> この表を使う</label>
      {msg && <p className="err">{msg}</p>}
      <div className="toolbar"><button onClick={save}>保存</button><button className="ghost" onClick={onClose}>やめる</button></div>
    </div></div>
  );
}
export default function LessonCheckPage() { return <MeProvider><Page /></MeProvider>; }
