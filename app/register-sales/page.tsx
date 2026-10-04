"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { todayJst } from "@/lib/period-nav";
import {
  ALL_KEYS, checkRow, COUNT_KEYS, COUNT_LABELS, emptyRow, GROUPS, monthRange, parseRegisterPaste, ratioOf, registerToTsv, SORTS, sortRows, SUB_LABELS, totalsOf,
  type RegisterKey, type RegisterRow, type SortId,
} from "@/lib/register-sales";
import { salesTabs } from "@/lib/sales-tabs";
import type { RegisterSalesData } from "@/lib/service";

const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const fmt = (n: number) => n.toLocaleString("ja-JP");
const toInt = (raw: string) => Number(raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "") || "0");
const STATUS = { none: "まだ入っていません", entered: "入力済み（事務員さんの確認待ち）", confirmed: "事務員さん確認済み" } as const;

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<{ id: string; name: string; status: string }[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [ym, setYm] = useState(() => addMonth(todayJst().slice(0, 7), -1));   // 先月ぶんから（月末にレジから出すため）
  const [data, setData] = useState<RegisterSalesData | null>(null);
  const [sort, setSort] = useState<SortId>("order");
  const [edit, setEdit] = useState<{ rows: RegisterRow[]; days: number } | null>(null);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  useEffect(() => { api<typeof stores>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);
  const load = useCallback(async () => { try { setData(await api<RegisterSalesData>(`/api/register-sales?storeId=${storeId}&month=${ym}`)); } catch (e) { setMsg((e as Error).message); } }, [storeId, ym]);
  useEffect(() => { setEdit(null); setOk(""); load(); }, [load]);
  useAutoRefresh(() => { if (!edit) load(); });

  const storeName = stores.find((s) => s.id === storeId)?.name ?? "";
  const range = monthRange(ym);
  const rows: RegisterRow[] = edit ? edit.rows : (data?.rows ?? []);
  const shown = useMemo(() => (edit ? rows : sortRows(rows, sort)), [rows, sort, edit]);
  const total = totalsOf(rows);
  const mine = me.level === 4 || storeId === me.storeId;
  const canEdit = !me.displayOnly && me.level >= 2 && mine && data?.status !== "confirmed";
  const canExport = !me.displayOnly && me.level >= 2 && mine && (data?.status === "confirmed" || me.level === 4) && rows.length > 0;

  const startEdit = () => { setMsg(""); setEdit({ rows: (data?.rows ?? []).map((r) => ({ ...r })), days: data?.days || 0 }); };
  const readPaste = () => {
    const r = parseRegisterPaste(paste);
    if (r.rows.length === 0) { setMsg("読み取れる行がありませんでした。レジの表の「スタッフ名」から「合計客数」までを、1行ずつ貼ってください"); return; }
    setEdit((cur) => ({ rows: r.rows, days: cur?.days ?? data?.days ?? 0 }));
    setMsg(r.skipped.length ? `${r.rows.length}行を読みました。読めなかった行が${r.skipped.length}行あります（下の表で足してください）` : ""); setPaste("");
  };
  const setCell = (i: number, k: RegisterKey, v: string) => setEdit((cur) => cur && { ...cur, rows: cur.rows.map((r, j) => (j === i ? { ...r, [k]: toInt(v) } : r)) });
  const save = async () => {
    if (!edit) return;
    try { await api("/api/register-sales", { action: "save", storeId, month: ym, days: edit.days, rows: edit.rows }); setEdit(null); setOk("保存しました（このお店の人に表示されます。事務員さんにお知らせが届きました）"); setMsg(""); await load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const confirmIt = async (on: boolean) => {
    if (!confirm(on ? "この表を「確認済み」にしますか？" : "「入力済み」にもどしますか？（もどすと、お店の人が直せます）")) return;
    try { await api("/api/register-sales", { action: "confirm", storeId, month: ym, on }); setOk(on ? "確認済みにしました" : "入力済みにもどしました"); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const exportXlsx = async () => {
    if (data?.status !== "confirmed" && !confirm("まだ事務員さんの確認前です。このままエクセルに出しますか？")) return;
    const { downloadRegisterXlsx } = await import("@/lib/register-xlsx");
    await downloadRegisterXlsx(rows, { storeName, month: ym, start: range.start, end: range.end, days: data?.days ?? 0, confirmed: data?.status === "confirmed" });
  };
  const copyTable = async () => { try { await navigator.clipboard.writeText(registerToTsv(rows)); setOk("表をコピーしました（エクセルに貼れます）"); } catch { setMsg("コピーできませんでした"); } };

  const cell = (r: RegisterRow, k: RegisterKey, i: number) => edit
    ? <td key={k}><input aria-label={`${r.name} ${k}`} inputMode="numeric" value={String(r[k])} onChange={(e) => setCell(i, k, e.target.value)} style={{ width: k.endsWith("Count") ? 52 : 92, padding: 6, fontSize: 14, margin: 0, textAlign: "right" }} /></td>
    : <td key={k} style={{ textAlign: "right" }}>{fmt(r[k])}</td>;

  return (
    <main className="wide" style={{ maxWidth: 1200 }}>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>売上</h1>
      <SubTabs items={salesTabs(me.level, me.displayOnly)} />
      <p className="hint">ここは「レジ売上」です。レジの「月間スタッフ売上表」と同じ表で、このお店の人だけが見られます。{canEdit && "レジの表を貼り付けて入れます。"}</p>
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        {me.level === 4 && stores.length > 1 && <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <button className="ghost" onClick={() => setYm(addMonth(ym, -1))} aria-label="前の月">‹</button>
        <b style={{ fontSize: 20 }}>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
        <button className="ghost" onClick={() => setYm(addMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      <p className="sub" style={{ margin: "4px 0 8px" }}>
        期間 {range.start} 〜 {range.end}　{edit ? <>稼働日数 <input inputMode="numeric" style={{ width: 56, margin: 0, padding: 4 }} value={String(edit.days)} onChange={(e) => setEdit({ ...edit, days: toInt(e.target.value) })} /> 日</> : <>稼働日数 <b style={{ fontSize: 18 }}>{data?.days ?? 0}日</b></>}　
        <b>{data ? STATUS[data.status] : "読み込み中…"}</b>
      </p>
      {ok && <p className="hint">{ok}</p>}
      {msg && <p className="err">{msg}</p>}

      <div className="actions" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {canEdit && !edit && <button style={{ width: "auto" }} onClick={startEdit}>{data?.status === "none" ? "レジの表を入れる" : "直す・入れ直す"}</button>}
        {edit && <button style={{ width: "auto" }} onClick={save}>この内容で保存（お店の人に見えます）</button>}
        {edit && <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={() => { setEdit(null); setMsg(""); }}>やめる</button>}
        {me.level === 4 && data?.status === "entered" && !edit && <button style={{ width: "auto" }} onClick={() => confirmIt(true)}>確認済みにする</button>}
        {me.level === 4 && data?.status === "confirmed" && <button className="ghost" style={{ width: "auto", color: "var(--sub)" }} onClick={() => confirmIt(false)}>入力済みにもどす</button>}
        {canExport && !edit && <button className="ghost" style={{ width: "auto", color: "var(--blue)" }} onClick={exportXlsx}>エクセルに出す</button>}
        {rows.length > 0 && !edit && <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={copyTable}>表をコピー</button>}
        {rows.length > 0 && !edit && <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={() => window.print()}>印刷</button>}
      </div>

      {edit && (
        <div className="card" style={{ marginBottom: 10 }}>
          <b>貼り付けで入れる</b>
          <p className="sub">レジの表（または、エクセルで写した表）を、1行＝1人で貼ります。「スタッフ名」から「合計客数」まで（売上比率はあってもなくても大丈夫です）。</p>
          <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} style={{ width: "100%", fontSize: 13 }} placeholder={"鬼塚 祐介\t1,086,800\t28,300\t0\t1,058,500\t57,100\t0\t0\t57,100\t1,143,900\t28,300\t0\t1,115,600\t13.1%\t1\t0\t76\t8\t0\t85"} />
          <button className="ghost" style={{ width: "auto", color: "var(--blue)" }} disabled={!paste.trim()} onClick={readPaste}>貼ったものを読み込む</button>
          <button className="ghost" style={{ width: "auto", color: "var(--blue)" }} onClick={() => setEdit({ ...edit, rows: [...edit.rows, emptyRow("")] })}>＋行を足す</button>
        </div>
      )}

      {rows.length === 0 && !edit && <p className="hint">この月の表は、まだ入っていません。</p>}
      {(rows.length > 0 || edit) && (
        <div className="scroll">
          <table className="sttable">
            <thead>
              <tr>
                <th rowSpan={2}>スタッフ</th>
                {GROUPS.map((g) => <th key={g.label} colSpan={4}>{g.label}</th>)}
                <th rowSpan={2}>売上<br />比率</th>
                {COUNT_KEYS.map((k) => <th key={k} rowSpan={2}>{COUNT_LABELS[k]}</th>)}
                {edit && <th rowSpan={2}></th>}
              </tr>
              <tr>{GROUPS.flatMap((g) => SUB_LABELS.map((s) => <th key={g.label + s}>{s}</th>))}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const bad = edit ? checkRow(r) : [];
                const idx = edit ? i : rows.indexOf(r);
                return (
                  <tr key={idx} title={bad.length ? `数字が合っていないかもしれません：${bad.join("・")}` : undefined} style={bad.length ? { background: "#fff1cc" } : undefined}>
                    <td className="name" style={{ textAlign: "left" }}>{edit ? <input aria-label="スタッフ名" value={r.name} onChange={(e) => setEdit({ ...edit, rows: edit.rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ width: 120, padding: 6, fontSize: 14, margin: 0 }} /> : r.name}{bad.length > 0 && <small style={{ color: "#b45309" }}> ⚠{bad[0]}</small>}</td>
                    {ALL_KEYS.slice(0, 12).map((k) => cell(r, k, idx))}
                    <td style={{ textAlign: "right" }}>{ratioOf(r, rows)}%</td>
                    {COUNT_KEYS.map((k) => cell(r, k, idx))}
                    {edit && <td><button className="ghost" aria-label="この行を消す" onClick={() => setEdit({ ...edit, rows: edit.rows.filter((_, j) => j !== i) })}>×</button></td>}
                  </tr>
                );
              })}
              <tr className="sumrow">
                <td className="name">合計</td>
                {ALL_KEYS.slice(0, 12).map((k) => <td key={k} style={{ textAlign: "right" }}>{fmt(total[k])}</td>)}
                <td style={{ textAlign: "right" }}>-</td>
                {COUNT_KEYS.map((k) => <td key={k} style={{ textAlign: "right" }}>{fmt(total[k])}</td>)}
                {edit && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ textAlign: "right", margin: "4px 0" }}>【税抜】</p>
      {!edit && rows.length > 0 && (
        <div className="actions noprint" style={{ flexWrap: "wrap" }}>
          {SORTS.map((s) => <button key={s.id} className={sort === s.id ? "" : "ghost"} style={{ width: "auto", color: sort === s.id ? undefined : "var(--ink)", fontSize: 13 }} onClick={() => setSort(s.id)}>{s.label}</button>)}
        </div>
      )}
      {data?.enteredAt && <p className="sub">入れた日時：{data.enteredAt.slice(0, 16)}{data.confirmedAt ? `　確認：${data.confirmedAt.slice(0, 16)}` : ""}</p>}
    </main>
  );
}
export default function RegisterSalesPage() { return <MeProvider><Page /></MeProvider>; }
