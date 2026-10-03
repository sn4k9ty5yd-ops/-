"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { achievement, newRate, pct1, signed, unitPrice, yen, yoy } from "@/lib/sales-calc";
import { todayJst } from "@/lib/period-nav";
import type { SalesRow, SalesValues, StoreRow } from "@/lib/service";

const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const toInt = (raw: string) => Number(raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "") || "0");
async function shrink(file: File): Promise<{ mime: string; base64: string }> {
  const bmp = await createImageBitmap(file); const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return { mime: "image/jpeg", base64: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
}
type Data = { month: string; rows: SalesRow[]; prev: Record<string, SalesValues>; storeTarget: number | null; targets: Record<string, number>; board: boolean; images: { id: string; at: string; by: string | null }[] };
const FIELDS: [keyof SalesValues, string][] = [["total", "総合売上"], ["free", "フリー売上"], ["nominated", "指名技術売上"], ["retail", "店販売上"], ["customers", "客数"], ["newCustomers", "新規"], ["repeatCustomers", "再来"]];

function Page() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [ym, setYm] = useState(todayJst().slice(0, 7));
  const [data, setData] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Record<string, SalesValues>>({});
  const [tEdit, setTEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))).catch(() => {}); }, []);
  const load = useCallback(async () => { try { setData(await api<Data>(`/api/sales?storeId=${storeId}&month=${ym}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); } }, [storeId, ym]);
  useEffect(() => { setEdit({}); setTEdit({}); load(); }, [load]);
  useAutoRefresh(() => { if (Object.keys(edit).length === 0 && Object.keys(tEdit).length === 0) load(); });

  const cur = useCallback((r: SalesRow): SalesValues => edit[r.membershipId] ?? r, [edit]);
  const sum = useMemo(() => (data?.rows ?? []).reduce((a, r) => { const v = cur(r); return { total: a.total + v.total, customers: a.customers + v.customers, n: a.n + v.newCustomers, rp: a.rp + v.repeatCustomers, retail: a.retail + v.retail }; }, { total: 0, customers: 0, n: 0, rp: 0, retail: 0 }), [data, cur]);
  const prevSum = useMemo(() => Object.values(data?.prev ?? {}).reduce((a, v) => ({ total: a.total + v.total, customers: a.customers + v.customers }), { total: 0, customers: 0 }), [data]);
  const setField = (r: SalesRow, k: keyof SalesValues, raw: string) => setEdit((e) => ({ ...e, [r.membershipId]: { ...cur(r), [k]: toInt(raw) } }));
  const dirty = Object.keys(edit).length;

  const save = async () => {
    try {
      await api("/api/sales", { action: "save", storeId, month: ym, rows: Object.entries(edit).map(([membershipId, values]) => ({ membershipId, values })) });
      setEdit({}); setOk("保存しました"); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const saveTarget = async (membershipId: string | null, raw: string) => {
    try { await api("/api/sales", { action: "target", storeId, month: ym, membershipId, target: raw.trim() === "" ? null : toInt(raw) }); setTEdit((t) => { const n = { ...t }; delete n[membershipId ?? "store"]; return n; }); setOk("目標を保存しました"); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const addImage = async (files: FileList | null) => {
    if (!files) return;
    try { for (const f of Array.from(files)) { const im = await shrink(f); await api("/api/sales", { action: "image", storeId, month: ym, image: im }); } setOk("写真を付けました（2か月だけ残ります）"); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  const canEdit = me.level === 4 || (me.level === 3 && storeId === me.storeId);
  if (me.level < 3) return <main className="wide"><Link href="/home" className="back">← ホーム</Link><h1>売上</h1><p className="hint">この画面は、店長と管理者が使います。自分の売上は、ホームの「自分の売上」から見られます。</p></main>;
  const tgt = data?.storeTarget ?? null;
  const ach = achievement(sum.total, tgt);

  return (
    <main className="xwide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>売上（指名売上）</h1>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {(me.level === 4 ? stores : stores.filter((s) => s.id === me.storeId)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="ghost" onClick={() => setYm(addMonth(ym, -1))} aria-label="前の月">‹</button>
        <b style={{ fontSize: 20 }}>{ym.slice(0, 4)}年{Number(ym.slice(5))}月</b>
        <button className="ghost" onClick={() => setYm(addMonth(ym, 1))} aria-label="次の月">›</button>
      </div>
      {msg && <p className="err">{msg}</p>}{ok && <p className="sub" style={{ color: "var(--ok)" }}>✅ {ok}</p>}

      <div className="stats">
        <div className="card"><div className="sub">お店の総合売上</div><div className="big">{yen(sum.total)}</div>
          {prevSum.total > 0 && <div className="sub">前年同月 {yen(prevSum.total)}　<b style={{ color: (yoy(sum.total, prevSum.total) ?? 0) >= 0 ? "var(--ok)" : "var(--bad)" }}>{signed(yoy(sum.total, prevSum.total) ?? 0)}</b></div>}</div>
        <div className="card"><div className="sub">お店の目標</div>
          {canEdit ? <div className="toolbar" style={{ margin: 0 }}><input inputMode="numeric" style={{ width: 150 }} placeholder="目標（円）" value={tEdit.store ?? (tgt === null ? "" : String(tgt))} onChange={(e) => setTEdit({ ...tEdit, store: e.target.value })} />
            <button className="ghost" onClick={() => saveTarget(null, tEdit.store ?? (tgt === null ? "" : String(tgt)))}>決める</button></div> : <div className="big">{tgt === null ? "未設定" : yen(tgt)}</div>}
          {ach !== null && <><div className="bar"><i style={{ width: `${Math.min(100, ach)}%` }} /></div><b>達成率 {ach}%</b>{tgt !== null && <span className="sub">　あと {yen(Math.max(0, tgt - sum.total))}</span>}</>}</div>
        <div className="card"><div className="sub">客数 ／ 客単価</div><div className="big">{sum.customers}人</div><div className="sub">客単価 {unitPrice(sum.total, sum.customers) === null ? "－" : yen(unitPrice(sum.total, sum.customers) as number)}</div></div>
        <div className="card"><div className="sub">新規 ／ 再来</div><div className="big">{newRate(sum.n, sum.rp) === null ? "－" : `${newRate(sum.n, sum.rp)}%`}</div><div className="sub">新規 {sum.n}人 ・ 再来 {sum.rp}人</div></div>
      </div>

      <div className="scroll card">
        <table className="sttable salestable">
          <thead><tr><th>名前</th>{FIELDS.map(([, l]) => <th key={l} className="r">{l}</th>)}<th className="r">客単価</th><th className="r">新規%</th><th className="r">前年比</th><th className="r">店内%</th><th className="r">個人目標</th><th className="r">達成</th></tr></thead>
          <tbody>{(data?.rows ?? []).map((r) => {
            const v = cur(r); const pv = data?.prev[r.membershipId]; const ptg = data?.targets[r.membershipId] ?? null; const y = yoy(v.total, pv?.total);
            return (
              <tr key={r.membershipId} className={edit[r.membershipId] ? "empty" : ""}>
                <td>{r.name}</td>
                {FIELDS.map(([k]) => <td key={k} className="r"><input className="cellin" inputMode="numeric" disabled={!canEdit} value={v[k] === 0 ? "" : String(v[k])} placeholder="0" onChange={(e) => setField(r, k, e.target.value)} /></td>)}
                <td className="r">{unitPrice(v.total, v.customers) ?? "－"}</td>
                <td className="r">{newRate(v.newCustomers, v.repeatCustomers) ?? "－"}</td>
                <td className="r" style={{ color: y === null ? undefined : y >= 0 ? "var(--ok)" : "var(--bad)" }}>{y === null ? "－" : signed(y)}</td>
                <td className="r">{pct1(v.total, sum.total) ?? "－"}</td>
                <td className="r">{canEdit ? <input className="cellin" inputMode="numeric" placeholder="－" value={tEdit[r.membershipId] ?? (ptg === null ? "" : String(ptg))} onChange={(e) => setTEdit({ ...tEdit, [r.membershipId]: e.target.value })} onBlur={() => { if (tEdit[r.membershipId] !== undefined) saveTarget(r.membershipId, tEdit[r.membershipId]); }} /> : ptg ?? "－"}</td>
                <td className="r">{achievement(v.total, ptg) ?? "－"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {canEdit && <div className="stickybar"><button onClick={save} disabled={dirty === 0}>保存する{dirty ? `（${dirty}人）` : ""}</button>{dirty > 0 && <button className="ghost" onClick={() => setEdit({})}>やめる</button>}</div>}
      <p className="hint">客単価・新規の割合・前年比・お店の中の割合は、自動で計算されます。前年の数字は、前年の同じ月に入れた数字です（前年のデータは、同じ画面で前年の月に入れてください）。</p>

      {canEdit && (
        <div className="card">
          <b>レジ画面の写真</b>
          <p className="sub">月末に、レジのパソコンの画面を撮って付けます（今月と先月の2か月分だけ残り、あとは自動で消えます。数字は残ります）。写真から数字を自動で読み取る機能は、実際のレジ画面を見てから作ります。</p>
          <input type="file" accept="image/*" multiple onChange={(e) => { addImage(e.target.files); e.target.value = ""; }} />
          <div className="lessonchips">{(data?.images ?? []).map((i) => (
            <a key={i.id} href={`/api/sales/image/${i.id}`} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/sales/image/${i.id}`} alt="レジ画面" style={{ height: 80, borderRadius: 8, border: "1px solid var(--hair)" }} /></a>))}</div>
        </div>
      )}
      {me.level === 4 && data && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" style={{ width: 20 }} checked={data.board} onChange={async (e) => { await api("/api/sales", { action: "board", storeId, month: ym, on: e.target.checked }); await load(); }} />このお店の「店内ランキング」を、スタッフにも見せる（順位・名前・総合売上）
        </label>
      )}
    </main>
  );
}
export default function SalesPage() { return <MeProvider><Page /></MeProvider>; }
