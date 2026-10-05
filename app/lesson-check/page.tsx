"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { isPassed, itemsMax, nextAttemptNo, sheetStatus, totalOfScores } from "@/lib/lesson-check";
import type { CheckAttempt, CheckData, CheckSheet } from "@/lib/service";

const SCORES = [1, 2, 3, 4, 5] as const;
const bg = { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" } as const;
const box = { background: "var(--card, #fff)", width: "100%", maxWidth: 760, maxHeight: "92vh", overflow: "auto", borderRadius: "18px 18px 0 0", padding: 16 } as const;

function Page() {
  const { me } = useMe();
  const [trainee, setTrainee] = useState<string>("");
  const [data, setData] = useState<CheckData | null>(null);
  const [grade, setGrade] = useState("1年目");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<CheckSheet | "new" | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<CheckData>(`/api/lesson-check${trainee ? `?trainee=${trainee}` : ""}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [trainee]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => { if (!open) load(); });

  const grades = useMemo(() => Array.from(new Set((data?.sheets ?? []).filter((s) => s.active).map((s) => s.grade))), [data]);
  if (!data) return <main><Link href="/manual" className="back">← マニュアル</Link><h1>レッスンチェック</h1>{msg && <p className="err">{msg}</p>}</main>;
  const mine = data.trainee?.id === me.id;
  const attOf = (id: string) => data.attempts.filter((a) => a.sheetId === id);
  const canScore = data.canAssess && !mine;

  if (open) {
    const sheet = data.sheets.find((x) => x.id === open);
    if (sheet && data.trainee) return (
      <>
        <Checklist key={sheet.id + data.trainee.id} sheet={sheet} attempts={attOf(sheet.id)} traineeId={data.trainee.id} traineeName={data.trainee.name}
          canScore={canScore} canEditSheets={data.canEditSheets} onBack={() => { setOpen(null); load(); }} onEdit={() => { setEdit(sheet); }} onSaved={load} />
        {edit && <SheetEditor sheet={edit === "new" ? null : edit} grade={grade} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      </>
    );
  }
  const sheets = data.sheets.filter((s) => s.active && s.grade === grade);

  return (
    <main className="wide">
      <Link href="/manual" className="back">← マニュアル</Link>
      <h1>レッスンチェック</h1>
      <p className="sub">技術のチェック表です。項目ごとに 1〜5 の点数をつけて、合計が合格点以上なら合格です。何回でも受け直せます。</p>
      {msg && <p className="err">{msg}</p>}
      {data.trainees.length > 0 && (
        <select value={trainee || me.id} onChange={(e) => setTrainee(e.target.value === me.id ? "" : e.target.value)} style={{ marginBottom: 10 }}>
          <option value={me.id}>{me.rank === "assistant" ? "自分" : "（アシスタントをえらぶ）"}</option>
          {data.trainees.filter((t) => t.id !== me.id).map((t) => <option key={t.id} value={t.id}>{t.storeName}　{t.name}</option>)}
        </select>
      )}
      {data.trainee ? <h2>{data.trainee.name} さん</h2> : <p className="hint">{data.trainees.length > 0 ? "上の一覧から、アシスタントをえらんでください。" : "レッスンチェックの対象は、アシスタントです。（アシスタントの人は、自分の結果がここに出ます）"}</p>}
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
              <p className="sub" style={{ margin: "4px 0" }}>{s.maxPoints}点満点・合格 {s.passPoints}点以上</p>
              {st.passedAt ? <span className="chip" style={{ color: "var(--ok)" }}>✅ {st.passedAt}回目で合格</span>
                : st.count ? <span className="chip">{st.count}回 ／ 最高 {st.best}点</span> : <span className="chip">まだ</span>}
            </div>
          );
        })}
      </div>
      {edit && <SheetEditor sheet={edit === "new" ? null : edit} grade={grade} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </main>
  );
}

/** 1つの表のチェックリスト: 回をえらび、項目ごとに 1〜5 のボタンを押す。合計は、押すたびに出る */
function Checklist({ sheet, attempts, traineeId, traineeName, canScore, canEditSheets, onBack, onEdit, onSaved }:
  { sheet: CheckSheet; attempts: CheckAttempt[]; traineeId: string; traineeName: string; canScore: boolean; canEditSheets: boolean; onBack: () => void; onEdit: () => void; onSaved: () => void }) {
  const items = sheet.items.filter((i) => i.active);
  const ids = items.map((i) => i.id);
  const firstNo = nextAttemptNo(sheet, attempts) ?? 1;
  const [no, setNo] = useState(canScore ? firstNo : attempts[attempts.length - 1]?.attemptNo ?? 1);
  const existing = attempts.find((a) => a.attemptNo === no);
  const [sc, setSc] = useState<Record<string, number>>(existing?.scores ?? {});
  const [time, setTime] = useState(existing?.time ?? "");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false); const [ok, setOk] = useState("");
  const pick = (n: number) => { const e = attempts.find((a) => a.attemptNo === n); setNo(n); setSc(e?.scores ?? {}); setTime(e?.time ?? ""); setComment(e?.comment ?? ""); setMsg(""); setOk(""); };
  const total = totalOfScores(sc, ids);
  const filled = ids.every((id) => sc[id] !== undefined && sc[id] >= 1);
  const answered = ids.filter((id) => sc[id] !== undefined).length;
  const passed = isPassed(total, sheet.passPoints);
  const editable = canScore;
  const run = async (body: object, done: string) => { setBusy(true); try { await api("/api/lesson-check", { method: "POST", body: JSON.stringify(body) }); setOk(done); onSaved(); } catch (e) { setMsg((e as Error).message); } setBusy(false); };

  return (
    <main className="wide">
      <button className="ghost" onClick={onBack}>← 表の一覧</button>
      <h1 style={{ marginBottom: 4 }}>{sheet.name}</h1>
      <p className="sub" style={{ margin: 0 }}>{traineeName} さん ／ {sheet.maxPoints}点満点・合格 {sheet.passPoints}点以上{canEditSheets && <> ／ <a href="#" onClick={(e) => { e.preventDefault(); onEdit(); }}>採点表を編集</a></>}</p>
      {sheet.memo && <p className="sub" style={{ whiteSpace: "pre-wrap" }}>{sheet.memo}</p>}

      <div className="seg" style={{ flexWrap: "wrap", margin: "10px 0" }}>
        {Array.from({ length: sheet.maxAttempts }, (_, i) => i + 1).map((n) => {
          const a = attempts.find((x) => x.attemptNo === n);
          return <button key={n} className={n === no ? "on" : ""} onClick={() => pick(n)}>{n}回目{a ? `（${a.total}${isPassed(a.total, sheet.passPoints) ? "✅" : ""}）` : ""}</button>;
        })}
      </div>
      {!editable && !existing && <p className="hint">この回は、まだ採点されていません。</p>}

      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((it, idx) => (
          <li key={it.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 6 }}><b>{idx + 1}.</b> {it.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {SCORES.map((n) => (
                <button key={n} disabled={!editable} className={sc[it.id] === n ? "" : "ghost"} onClick={() => setSc({ ...sc, [it.id]: n })}
                  style={{ padding: "12px 0", fontSize: 18, fontWeight: 700, opacity: !editable && sc[it.id] !== n ? 0.45 : 1 }} aria-label={`${n}点`}>{n}</button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <p className="sub">1 できていない ／ 2 もう少し ／ 3 ふつう ／ 4 よい ／ 5 とてもよい</p>

      {editable && (
        <>
          <input placeholder="タイム（例 4:30）" value={time} onChange={(e) => setTime(e.target.value)} style={{ marginBottom: 6 }} />
          <textarea placeholder="コメント（任意）" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </>
      )}
      {!editable && existing && (existing.time || existing.comment) && <p className="sub">{existing.time && <>タイム {existing.time}　</>}{existing.comment}{existing.assessorName && <>　（査定：{existing.assessorName}）</>}</p>}

      <div className="card" style={{ position: "sticky", bottom: 8, boxShadow: "0 4px 18px rgba(0,0,0,.18)", marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <span><b style={{ fontSize: 28 }}>{total}</b> / {sheet.maxPoints}点　<span className="sub">合格 {sheet.passPoints}点</span></span>
          <b style={{ color: filled ? (passed ? "var(--ok)" : "var(--bad)") : undefined }}>{filled ? (passed ? "✅ 合格" : "もう少し") : `${answered}/${ids.length}項目`}</b>
        </div>
        {msg && <p className="err">{msg}</p>}{ok && <p className="sub">{ok}</p>}
        {editable && (
          <div className="toolbar">
            <button disabled={busy || !filled} onClick={() => run({ action: "attempt", sheetId: sheet.id, traineeId, attemptNo: no, time, comment, scores: items.map((i) => ({ itemId: i.id, score: sc[i.id] })) }, "保存しました")}>{existing ? "直して保存" : "この回を保存"}</button>
            {existing && <button className="ghost" disabled={busy} onClick={() => confirm("この回の採点を取り消しますか？") && run({ action: "delete", attemptId: existing.id }, "取り消しました").then(() => { setSc({}); setTime(""); setComment(""); })}>取り消す</button>}
          </div>
        )}
      </div>
    </main>
  );
}

function SheetEditor({ sheet, grade, onClose, onDone }: { sheet: CheckSheet | null; grade: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ grade: sheet?.grade ?? grade, name: sheet?.name ?? "", memo: sheet?.memo ?? "", maxPoints: sheet?.maxPoints ?? 25, passPoints: sheet?.passPoints ?? 20, maxAttempts: sheet?.maxAttempts ?? 10, active: sheet?.active ?? true });
  const [items, setItems] = useState<{ id?: string; name: string }[]>((sheet?.items.filter((i) => i.active) ?? []).map((i) => ({ id: i.id, name: i.name })));
  const [msg, setMsg] = useState("");
  const num = (k: "maxPoints" | "passPoints" | "maxAttempts") => <input type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />;
  const save = async () => { try { await api("/api/lesson-check", { method: "POST", body: JSON.stringify({ action: "sheet", id: sheet?.id, ...f, items: items.filter((i) => i.name.trim()) }) }); onDone(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div style={{ ...bg, zIndex: 60 }} onClick={onClose}><div style={box} onClick={(e) => e.stopPropagation()}>
      <h2 style={{ marginTop: 0 }}>{sheet ? "採点表を編集" : "採点表を足す"}</h2>
      <label>学年（1年目・2年目など）<input value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} /></label>
      <label>名前<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>メモ（制限時間など）<textarea rows={3} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></label>
      <div className="grid2"><label>満点（項目×5・自動）<input value={itemsMax({ items: items.map((i) => ({ id: i.id ?? "", active: i.name.trim() !== "" })) })} readOnly /></label><label>合格点{num("passPoints")}</label><label>回数{num("maxAttempts")}</label></div>
      <p className="sub">満点は、項目の点数（各5点）の合計です。合格点の目安（8割）は {Math.ceil(itemsMax({ items: items.map((i) => ({ id: i.id ?? "", active: i.name.trim() !== "" })) }) * 0.8)}点です。</p>
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
