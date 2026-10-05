"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { reiwa } from "@/lib/era";
import { findTemplate, INTERVIEW_TEMPLATES } from "@/lib/interview-sheets";
import { mentorTabs } from "@/lib/mentor-tabs";
import { todayJst } from "@/lib/period-nav";
import type { InterviewRow } from "@/lib/service";

const STATUS: Record<string, string> = { draft: "下書き", submitted: "店長の確認待ち", reviewed: "確認済み" };

function Page() {
  const { me } = useMe();
  const [data, setData] = useState<{ rows: InterviewRow[]; isManager: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ menteeId: string; template: string; heldOn: string } | null>(null);
  const [mentees, setMentees] = useState<{ id: string; name: string; rank: string | null }[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { try { setData(await api("/api/interviews")); setMsg(""); } catch (e) { setMsg((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => { if (!open) load(); });

  if (!data) return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>メンター</h1>{msg && <p className="err">{msg}</p>}</main>;
  const iv = open ? data.rows.find((r) => r.id === open) : null;
  if (iv) return <Sheet row={iv} isManager={data.isManager} onBack={() => { setOpen(null); load(); }} />;

  const mine = data.rows.filter((r) => r.mine);
  const toMe = data.rows.filter((r) => !r.mine);
  const Row = ({ r }: { r: InterviewRow }) => (
    <li style={{ cursor: "pointer" }} onClick={() => setOpen(r.id)}>
      <div><b>{r.menteeName}</b>さん　<span className="sub">{findTemplate(r.template)?.label}　{reiwa(r.heldOn)}</span>
        {!r.mine && <div className="sub">書いた人：{r.authorName}</div>}</div>
      <span className="chip">{STATUS[r.status]}</span>
    </li>
  );
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>メンター</h1>
      <SubTabs items={mentorTabs(me.displayOnly)} />
      <p className="sub">メンター面談の記録です。面談したあとに書いて、店長に提出します。</p>
      {msg && <p className="err">{msg}</p>}
      {!form && <button onClick={async () => { setMentees(await api("/api/interviews?mentees=1")); setForm({ menteeId: "", template: "oct", heldOn: todayJst() }); }}>＋ 面談シートを書く</button>}
      {form && (
        <div className="card" style={{ margin: "10px 0" }}>
          <label>面談を受けた人
            <select value={form.menteeId} onChange={(e) => setForm({ ...form, menteeId: e.target.value })}>
              <option value="">えらんでください</option>
              {mentees.map((m) => <option key={m.id} value={m.id}>{m.name}{m.rank === "assistant" ? "（アシスタント）" : ""}</option>)}
            </select></label>
          <label>面談の種類
            <select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>{INTERVIEW_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label>日付<input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
          <div className="toolbar">
            <button disabled={!form.menteeId} onClick={async () => { try { const r = await api<{ id: string }>("/api/interviews", { action: "create", ...form }); setForm(null); await load(); setOpen(r.id); } catch (e) { setMsg((e as Error).message); } }}>つくる</button>
            <button className="ghost" onClick={() => setForm(null)}>やめる</button>
          </div>
        </div>
      )}
      {data.isManager && toMe.length > 0 && (
        <>
          <h2>店長：提出された面談シート</h2>
          <ul className="list">{toMe.map((r) => <Row key={r.id} r={r} />)}</ul>
        </>
      )}
      <h2>自分が書いた面談シート</h2>
      {mine.length === 0 && <p className="hint">まだありません。</p>}
      <ul className="list">{mine.map((r) => <Row key={r.id} r={r} />)}</ul>
    </main>
  );
}

function Sheet({ row, isManager, onBack }: { row: InterviewRow; isManager: boolean; onBack: () => void }) {
  const t = findTemplate(row.template);
  const editable = row.mine && row.status === "draft";
  const [answers, setAnswers] = useState<Record<string, string>>(row.answers ?? {});
  const [memo, setMemo] = useState(row.memo);
  const [comment, setComment] = useState(row.reviewComment);
  const [saved, setSaved] = useState(""); const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (a: Record<string, string>, m: string) => {
    try { await api("/api/interviews", { action: "save", id: row.id, answers: a, memo: m }); setSaved("保存しました"); } catch (e) { setMsg((e as Error).message); }
  }, [row.id]);
  const later = (a: Record<string, string>, m: string) => { setSaved("入力中…"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => save(a, m), 1200); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <main className="wide">
      <button className="ghost noprint" onClick={onBack}>← 面談シートの一覧</button>
      <h1 style={{ marginBottom: 2 }}>{row.menteeName}さん　{t?.label}</h1>
      <p className="sub" style={{ margin: 0 }}>{reiwa(row.heldOn)}　書いた人：{row.authorName}　<span className="chip">{STATUS[row.status]}</span>　{saved}</p>
      {t && <p className="sub">{t.hint}</p>}
      {msg && <p className="err">{msg}</p>}
      {(t?.questions ?? []).map((q) => (
        <div key={q} className="card" style={{ margin: "8px 0" }}>
          <b style={{ whiteSpace: "pre-wrap" }}>{q}</b>
          {editable
            ? <textarea rows={3} value={answers[q] ?? ""} onChange={(e) => { const a = { ...answers, [q]: e.target.value }; setAnswers(a); later(a, memo); }} />
            : <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{answers[q] || <span className="sub">（記入なし）</span>}</div>}
        </div>
      ))}
      <div className="card" style={{ margin: "8px 0" }}>
        <b>備考欄　メモ</b>
        {editable ? <textarea rows={4} value={memo} onChange={(e) => { setMemo(e.target.value); later(answers, e.target.value); }} /> : <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{memo || <span className="sub">（なし）</span>}</div>}
      </div>
      {editable && (
        <div className="toolbar">
          <button onClick={async () => {
            if (!confirm("店長に提出しますか？（提出すると、直せなくなります）")) return;
            try { if (timer.current) clearTimeout(timer.current); await save(answers, memo); const r = await api<{ notified: number }>("/api/interviews", { action: "submit", id: row.id });
              alert(r.notified > 0 ? "店長に提出しました" : "提出しました（このお店に店長が登録されていないため、お知らせは届いていません）"); onBack(); } catch (e) { setMsg((e as Error).message); }
          }}>店長に提出する</button>
        </div>
      )}
      {!editable && row.status === "reviewed" && row.reviewComment && <div className="card"><b>店長のコメント</b><div style={{ whiteSpace: "pre-wrap" }}>{row.reviewComment}</div></div>}
      {isManager && !row.mine && row.status !== "draft" && (
        <div className="card" style={{ margin: "8px 0" }}>
          <b>店長：確認する</b>
          <textarea rows={3} placeholder="コメント（任意）" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button onClick={async () => { try { await api("/api/interviews", { action: "review", id: row.id, comment }); onBack(); } catch (e) { setMsg((e as Error).message); } }}>{row.status === "reviewed" ? "コメントを直して、確認済みにする" : "確認済みにする"}</button>
        </div>
      )}
    </main>
  );
}
export default function InterviewsPage() { return <MeProvider><Page /></MeProvider>; }
