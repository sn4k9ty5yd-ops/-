"use client";
import { useState } from "react";
import { api, useMe } from "@/lib/client";
import { RECORD_SECTIONS, type RecordsDoc } from "@/lib/service";

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const cell = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return v.toLocaleString("ja-JP");
  if (typeof v === "object") return Array.isArray(v) && v.length === 0 ? "" : JSON.stringify(v).slice(0, 160);
  return String(v);
};
function Table({ title, rows, note }: { title: string; rows?: Record<string, unknown>[]; note?: string }) {
  if (!rows) return null;
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <section className="docsec">
      <h2>{title}（{rows.length}件）</h2>
      {note && <p className="sub">{note}</p>}
      {rows.length === 0 ? <p className="hint">この期間の記録はありません。</p> : (
        <table className="doctable"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === "number" ? "r" : ""}>{cell(r[c])}</td>)}</tr>)}</tbody></table>
      )}
    </section>
  );
}

export default function RecordsPage() {
  const { me } = useMe();
  const y = Number(today().slice(0, 4));
  const [from, setFrom] = useState(`${y}-01-01`); const [to, setTo] = useState(`${y}-12-31`);
  const [sel, setSel] = useState<string[]>(RECORD_SECTIONS.map(([k]) => k));
  const [detail, setDetail] = useState(false);
  const [doc, setDoc] = useState<RecordsDoc | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true); setMsg("");
    try { setDoc(await api<RecordsDoc>("/api/records", { from, to, sections: sel, detail })); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  if (me.level < 4) return <p className="hint">この画面は、管理者・事務員さんだけが使えます。</p>;

  return (
    <>
      <div className="noprint">
        <h1>税務署などに出す書面（全情報）</h1>
        <p className="sub">期間と項目をえらんで「書面をつくる」を押すと、アプリの記録がまとまった書面ができます。「印刷する」から、紙にしたり、PDFにして保存したりできます。書面を作ったことは、「大切な操作の記録」に残ります。</p>
        <div className="card">
          <div className="toolbar">
            <label style={{ margin: 0 }}>はじめ<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label style={{ margin: 0 }}>おわり<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="ghost" onClick={() => { setFrom(`${y}-01-01`); setTo(`${y}-12-31`); }}>今年</button>
            <button className="ghost" onClick={() => { setFrom(`${y - 1}-01-01`); setTo(`${y - 1}-12-31`); }}>昨年</button>
            <button className="ghost" onClick={() => { setFrom(`${y - 4}-01-01`); setTo(`${y}-12-31`); }}>5年分</button>
          </div>
          <div className="storeboxes">{RECORD_SECTIONS.map(([k, l]) => (
            <label key={k}><input type="checkbox" checked={sel.includes(k)} onChange={(e) => setSel(e.target.checked ? [...sel, k] : sel.filter((x) => x !== k))} />{l}</label>))}</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: 20 }} checked={detail} onChange={(e) => setDetail(e.target.checked)} />くわしい記録も入れる（出勤簿の1日ごと・棚卸しの1品ごと。ページ数が多くなります）</label>
          {msg && <p className="err">{msg}</p>}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button onClick={make} disabled={busy || sel.length === 0}>{busy ? "つくっています…" : "書面をつくる"}</button>
            {doc && <button className="ghost" onClick={() => window.print()}>印刷する（PDFにもできます）</button>}
          </div>
        </div>
      </div>

      {doc && (
        <article className="doc">
          <header className="doccover">
            <p className="docco">{doc.meta.company}</p>
            <h1>業務記録 書面</h1>
            <table className="covertable"><tbody>
              <tr><th>対象の期間</th><td>{doc.meta.from} 〜 {doc.meta.to}</td></tr>
              <tr><th>出した項目</th><td>{RECORD_SECTIONS.filter(([k]) => doc.meta.sections.includes(k)).map(([, l]) => l).join("、")}{doc.meta.detail ? "（くわしい記録つき）" : ""}</td></tr>
              <tr><th>作った日時</th><td>{new Date(doc.meta.generatedAt).toLocaleString("ja-JP")}</td></tr>
              <tr><th>作った人</th><td>{doc.meta.by}</td></tr>
              <tr><th>整合性コード</th><td><code>{doc.meta.hash.slice(0, 32)}</code><br /><span className="sub">（この書面のデータから計算した文字列です。データが変わると、コードも変わります）</span></td></tr>
            </tbody></table>
            <p className="sub">この書面は、株式会社ALBUMの業務システムに記録されている内容を、そのまま出力したものです。金額は、とくに書いてなければ円（税抜）です。パスコードなどの秘密の情報は含みません。</p>
          </header>
          <Table title="1. スタッフ名簿" rows={doc.staff} />
          <Table title="2. 出勤簿（月ごとのまとめ）" rows={doc.attendance} />
          <Table title="2-2. 出勤簿（1日ごと）" rows={doc.attendanceDaily} />
          <Table title="3. 売上と歩合" rows={doc.sales} />
          <Table title="4. 材料費（発注の記録）" rows={doc.materials} note="「取り消し」は、消さずに残した記録です。" />
          <Table title="4-2. 材料費（月・お店ごとの合計。取り消しを除く）" rows={doc.materialsByMonth} />
          <Table title="5. 棚卸し" rows={doc.stocktake} />
          <Table title="5-2. 棚卸し（1品ごと）" rows={doc.stocktakeLines} />
          <Table title="6. 有給の日" rows={doc.leavePlans} />
          <Table title="6-2. 有給の変更の申請と結果" rows={doc.leaveChanges} />
          <Table title="7. レッスン記録（回数）" rows={doc.lessons} />
          <Table title="8. 大切な操作の記録" rows={doc.audit} />
          <footer className="docfoot">以上　／　整合性コード {doc.meta.hash.slice(0, 16)}　／　{doc.meta.company}　／　{new Date(doc.meta.generatedAt).toLocaleDateString("ja-JP")}</footer>
        </article>
      )}
    </>
  );
}
