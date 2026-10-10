"use client";
import { useCallback, useEffect, useState } from "react";
import { Stepper } from "@/app/Stepper";
import { api, useAutoRefresh } from "@/lib/client";
import { SPA_DEDUCT_PER_PERSON, yen } from "@/lib/sales-calc";
import type { SpaClaim, SpaLine, SpaStatus } from "@/lib/service";

const LABEL: Record<SpaStatus, string> = { draft: "下書き", submitted: "店長の確認待ち", approved: "確認ずみ", returned: "差し戻し中" };
const num = (raw: string) => Number(raw.replace(/[^\d]/g, "") || "0");
export const spaTotals = (lines: SpaLine[], ratePercent: number) => {
  const people = lines.reduce((a, l) => a + l.count, 0), gross = lines.reduce((a, l) => a + l.price * l.count, 0);
  const net = Math.max(0, gross - SPA_DEDUCT_PER_PERSON * people);
  return { people, gross, net, commission: Math.floor((net * ratePercent) / 100) };
};

/** 自分のヘッドスパ申請（単価×人数を行ごとに入れて、申請する） */
export function SpaMine({ ym, ratePercent, onChange }: { ym: string; ratePercent: number; onChange?: (c: SpaClaim | null) => void }) {
  const [claim, setClaim] = useState<SpaClaim | null | undefined>(undefined);
  const [lines, setLines] = useState<SpaLine[] | null>(null);
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const load = useCallback(async () => {
    try { const r = await api<{ claim: SpaClaim | null }>(`/api/sales?spaMine=1&month=${ym}`); setClaim(r.claim); onChange?.(r.claim); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  }, [ym, onChange]);
  useEffect(() => { setLines(null); setOk(""); load(); }, [load]);
  useAutoRefresh(() => { if (lines === null) load(); });
  if (claim === undefined) return <div className="card"><b>ヘッドスパを申請する</b>{msg && <p className="err">{msg}</p>}</div>;
  const editable = !claim || claim.status === "draft" || claim.status === "returned";
  const cur = lines ?? (claim?.lines.length ? claim.lines : [{ price: 0, count: 0 }]);
  const t = spaTotals(cur.filter((l) => l.count > 0), ratePercent);
  const set = (i: number, k: keyof SpaLine, v: number) => setLines(cur.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const clean = () => cur.filter((l) => l.count > 0).map((l) => ({ price: l.price, count: l.count }));
  const run = async (submit: boolean) => {
    try {
      await api("/api/sales", { action: "spa-save", month: ym, lines: clean() });
      if (submit) await api("/api/sales", { action: "spa-submit", month: ym });
      setLines(null); setOk(submit ? "申請しました（店長に通知しました）" : "保存しました"); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="card">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}><b style={{ fontSize: 18 }}>ヘッドスパを申請する</b>
        <span className="chip" style={{ color: claim?.status === "approved" ? "var(--ok)" : claim?.status === "returned" ? "var(--bad)" : undefined }}>{claim ? LABEL[claim.status] : "まだ申請していません"}</span></div>
      <p className="sub" style={{ margin: "6px 0" }}>やったヘッドスパを、<b>単価ごと</b>に入れます（例：1,800円を2人、4,500円を3人）。人数×{SPA_DEDUCT_PER_PERSON.toLocaleString("ja-JP")}円を引いた金額に、歩合 {ratePercent}% がつきます。</p>
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub" style={{ color: "var(--ok)" }}>✅ {ok}</p>}
      {claim?.status === "returned" && <p className="err">差し戻されました{claim.returnComment ? `：「${claim.returnComment}」` : ""}。直して、もう一度申請してください。</p>}
      {cur.map((l, i) => (
        <div key={i} className="toolbar" style={{ alignItems: "flex-end" }}>
          <label style={{ margin: 0 }}>単価（円）<Stepper label="ヘッドスパの単価" disabled={!editable} step={100} bigStep={1000} max={9999999} value={l.price === 0 ? "" : String(l.price)} placeholder="0" onChange={(x) => set(i, "price", num(x))} /></label>
          <label style={{ margin: 0 }}>人数（人）<Stepper label="ヘッドスパの人数" disabled={!editable} step={1} max={9999} value={l.count === 0 ? "" : String(l.count)} placeholder="0" onChange={(x) => set(i, "count", num(x))} /></label>
          {editable && cur.length > 1 && <button className="ghost" onClick={() => setLines(cur.filter((_, j) => j !== i))}>この行を消す</button>}
        </div>
      ))}
      {editable && cur.length < 30 && <button className="ghost" onClick={() => setLines([...cur, { price: 0, count: 0 }])}>＋ 単価をふやす</button>}
      <table className="sttable"><tbody>
        <tr><td>合計の売上</td><td className="r">{yen(t.gross)}</td></tr>
        <tr><td>やった人数</td><td className="r">{t.people}人</td></tr>
        <tr><td>人数×{SPA_DEDUCT_PER_PERSON.toLocaleString("ja-JP")}円を引いたあと（事務所に報告する金額）</td><td className="r"><b>{yen(t.net)}</b></td></tr>
        <tr className="sumrow"><td>歩合の目安（{ratePercent}%）</td><td className="r"><b>{yen(t.commission)}</b></td></tr>
      </tbody></table>
      {editable && <div className="toolbar"><button onClick={() => run(true)} disabled={t.people < 1}>申請する</button><button className="ghost" onClick={() => run(false)}>保存だけ</button>{lines && <button className="ghost" onClick={() => setLines(null)}>やめる</button>}</div>}
      {!editable && <p className="hint">申請したあとは、直せません。直したいときは、店長に「差し戻し」をお願いしてください。</p>}
    </div>
  );
}

/** 店長・正美さん：お店の人のヘッドスパ申請を確認する */
export function SpaReview({ claims, ym, canReview, meId, rate, reload }: { claims: SpaClaim[]; ym: string; canReview: boolean; meId: string; rate: number; reload: () => void }) {
  const [msg, setMsg] = useState("");
  const act = async (c: SpaClaim, spa: "approve" | "return", comment = "") => {
    try { await api("/api/sales", { action: "spa-review", month: ym, membershipId: c.membershipId, spa, comment }); setMsg(""); reload(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="card">
      <b style={{ fontSize: 18 }}>ヘッドスパの申請</b>
      <p className="sub" style={{ margin: "6px 0" }}>アシスタントが、自分で調べて申請します。人数×{SPA_DEDUCT_PER_PERSON.toLocaleString("ja-JP")}円を引いた金額が、事務所への報告の金額です。</p>
      {msg && <p className="err">{msg}</p>}
      {claims.length === 0 ? <p className="hint">この月の申請は、まだありません。</p> : (
        <table className="sttable"><thead><tr><th>名前</th><th>状態</th><th className="r">売上の合計</th><th className="r">人数</th><th className="r">引いたあと</th><th className="r">歩合の目安</th><th /></tr></thead>
          <tbody>{claims.map((c) => { const t = spaTotals(c.lines, rate); return (
            <tr key={c.membershipId}>
              <td>{c.name}<div className="sub">{c.lines.map((l) => `${l.price.toLocaleString("ja-JP")}円×${l.count}人`).join("、")}</div></td>
              <td><span className="chip" style={{ color: c.status === "approved" ? "var(--ok)" : c.status === "returned" ? "var(--bad)" : undefined }}>{LABEL[c.status]}</span></td>
              <td className="r">{yen(t.gross)}</td><td className="r">{t.people}人</td><td className="r"><b>{yen(t.net)}</b></td><td className="r">{yen(t.commission)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{canReview && c.membershipId !== meId && <>
                {c.status === "submitted" && <button className="ghost" onClick={() => act(c, "approve")}>確認</button>}
                {(c.status === "submitted" || c.status === "approved") && <button className="ghost" style={{ color: "var(--bad)" }} onClick={() => { const x = prompt("差し戻しのコメント（なくてもOK）", ""); if (x !== null) act(c, "return", x); }}>差し戻す</button>}
              </>}</td>
            </tr>); })}</tbody></table>
      )}
    </div>
  );
}
