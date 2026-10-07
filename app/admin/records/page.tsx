"use client";
import { useEffect, useMemo, useState } from "react";
import { api, useMe } from "@/lib/client";
import { RECORD_SECTIONS, type RecordsDoc, type StaffRow, type StoreRow } from "@/lib/service";

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
  // 社員をえらぶ（税務署の調査で、特定の人の分だけ出すとき）。えらばなければ全員
  const [staff, setStaff] = useState<StaffRow[]>([]); const [stores, setStores] = useState<StoreRow[]>([]);
  const [who, setWho] = useState<string[]>([]); const [all, setAll] = useState(true); const [q, setQ] = useState("");
  const [own, setOwn] = useState(false);                                  // 書類ごとに期間を変える
  const [ranges, setRanges] = useState<Record<string, { from: string; to: string }>>({});
  useEffect(() => { Promise.all([api<StaffRow[]>("/api/staff"), api<StoreRow[]>("/api/stores")]).then(([a, b]) => { setStaff(a); setStores(b); }).catch(() => {}); }, []);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const shownStaff = useMemo(() => staff.filter((s) => !q || `${s.name}${s.employeeCode}${storeName(s.storeId)}`.includes(q)), [staff, q, stores]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangeOf = (k: string) => ranges[k] ?? { from, to };

  const make = async () => {
    setBusy(true); setMsg("");
    try { setDoc(await api<RecordsDoc>("/api/records", { from, to, sections: sel, detail, staffIds: all ? [] : who, ranges: own ? Object.fromEntries(sel.map((k) => [k, rangeOf(k)])) : {} })); } catch (e) { setMsg((e as Error).message); }
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
          <p className="sub" style={{ margin: "8px 0 4px" }}><b>だれの分？</b>（税務署の調査などで、特定の人だけ出すとき）</p>
          <div className="seg" style={{ margin: "0 0 8px" }}><button className={all ? "on" : ""} onClick={() => setAll(true)}>全員</button><button className={!all ? "on" : ""} onClick={() => setAll(false)}>人をえらぶ</button></div>
          {!all && (
            <div style={{ marginBottom: 8 }}>
              <div className="toolbar"><input aria-label="さがす" placeholder="名前・社員番号・お店でさがす" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
                <button className="ghost" onClick={() => setWho([...new Set([...who, ...shownStaff.map((s) => s.id)])])}>表示中を全部えらぶ</button>
                <button className="ghost" onClick={() => setWho([])}>えらびなおす</button></div>
              <p className="sub" style={{ margin: "0 0 4px" }}><b>{who.length}人</b>えらんでいます（退職した人も出ます）</p>
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: 6 }}>
                {shownStaff.map((s) => (
                  <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "2px 0", fontSize: 14, color: "var(--ink)" }}>
                    <input type="checkbox" style={{ width: 18, height: 18 }} checked={who.includes(s.id)} onChange={(e) => setWho(e.target.checked ? [...who, s.id] : who.filter((x) => x !== s.id))} />
                    {s.name}　<span className="sub">{s.employeeCode}・{storeName(s.storeId)}{s.status === "disabled" ? "・退職" : ""}</span>
                  </label>))}
              </div>
              <p className="sub" style={{ margin: "4px 0 0" }}>※ 材料費・棚卸しは、人ごとの記録ではないので、えらんでも、期間の分が全部出ます。</p>
            </div>)}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: 20 }} checked={own} onChange={(e) => setOwn(e.target.checked)} />書類ごとに、期間を変える（たとえば、出勤簿は3年・売上は1年）</label>
          {own && (
            <div style={{ margin: "6px 0 8px" }}>
              {RECORD_SECTIONS.filter(([k]) => sel.includes(k)).map(([k, l]) => (
                <div key={k} className="toolbar" style={{ alignItems: "center", margin: "2px 0" }}>
                  <span style={{ minWidth: 190, fontSize: 14 }}>{l}</span>
                  <input type="date" aria-label={`${l}のはじめ`} value={rangeOf(k).from} onChange={(e) => setRanges({ ...ranges, [k]: { ...rangeOf(k), from: e.target.value } })} />
                  <span>〜</span>
                  <input type="date" aria-label={`${l}のおわり`} value={rangeOf(k).to} onChange={(e) => setRanges({ ...ranges, [k]: { ...rangeOf(k), to: e.target.value } })} />
                </div>))}
            </div>)}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: 20 }} checked={detail} onChange={(e) => setDetail(e.target.checked)} />くわしい記録も入れる（出勤簿の1日ごと・棚卸しの1品ごと。ページ数が多くなります）</label>
          {msg && <p className="err">{msg}</p>}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button onClick={make} disabled={busy || sel.length === 0 || (!all && who.length === 0)}>{busy ? "つくっています…" : "書面をつくる"}</button>
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
              <tr><th>だれの分</th><td>{doc.meta.staff ? `${doc.meta.staff.length}人：${doc.meta.staff.join("、")}` : "全員"}</td></tr>
              {doc.meta.ranges && Object.keys(doc.meta.ranges).length > 0 && Object.entries(doc.meta.ranges).some(([, r]) => r.from !== doc.meta.from || r.to !== doc.meta.to) && (
                <tr><th>書類ごとの期間</th><td>{RECORD_SECTIONS.filter(([k]) => doc.meta.ranges?.[k]).map(([k, l]) => `${l}：${doc.meta.ranges![k].from}〜${doc.meta.ranges![k].to}`).join(" ／ ")}</td></tr>)}
              <tr><th>作った日時</th><td>{new Date(doc.meta.generatedAt).toLocaleString("ja-JP")}</td></tr>
              <tr><th>作った人</th><td>{doc.meta.by}</td></tr>
              <tr><th>整合性コード</th><td><code>{doc.meta.hash.slice(0, 32)}</code><br /><span className="sub">（この書面のデータから計算した文字列です。データが変わると、コードも変わります）</span></td></tr>
            </tbody></table>
            <p className="sub">この書面は、株式会社ALBUMの業務システムに記録されている内容を、そのまま出力したものです。金額は、とくに書いてなければ円（税抜）です。パスコードなどの秘密の情報は含みません。</p>
          </header>
          <Table title="1. スタッフ名簿" rows={doc.staff} />
          <Table title="1-2. 出勤簿予定（シフト）" rows={doc.shiftsPlan} />
          <Table title="1-3. 希望休" rows={doc.offRequests} />
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
