"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { reiwaDot } from "@/lib/era";
import { PRODUCT_KIND_LABEL, STOCKTAKE_LABEL, type ProductKind, type StocktakeDetail, type StocktakeRow, type StocktakeSummary, type StoreRow } from "@/lib/service";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const monthEnd = () => { const d = new Date(Date.now() + 9 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };

/** 表をコピー（Excel・メールにそのままはりつけられるタブ区切り） */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy"); t.remove(); return ok;
  }
}

export default function StocktakePage() {
  const { me } = useMe();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [kind, setKind] = useState<ProductKind>("retail");
  const [list, setList] = useState<StocktakeRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "summary">("list");
  const [takenOn, setTakenOn] = useState(monthEnd());
  const [msg, setMsg] = useState("");
  const store = stores.find((s) => s.id === storeId);
  const canStart = me.level === 4 || (me.level === 3 && storeId === me.storeId);

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))); }, []);
  const loadList = useCallback(async () => { setList(await api<StocktakeRow[]>(`/api/stocktakes?storeId=${storeId}&kind=${kind}`)); }, [storeId, kind]);
  useEffect(() => { if (!openId) loadList().catch(() => {}); }, [loadList, openId]);
  useAutoRefresh(() => { if (!openId) loadList().catch(() => {}); });

  if (openId) return <Detail id={openId} storeName={store?.name ?? ""} onBack={() => setOpenId(null)} />;
  return (
    <>
      <h1>棚卸し</h1>
      <div className="seg"><button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>棚卸し表（お店・種類ごと）</button><button className={view === "summary" ? "on" : ""} onClick={() => setView("summary")}>合算（店販・業務・全店）</button></div>
      {view === "summary" ? <Summary stores={me.level >= 3 ? stores : stores.filter((s) => s.id === me.storeId)} onOpen={(id) => { setOpenId(id); }} /> : <>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{(me.level >= 3 ? stores : stores.filter((s) => s.id === me.storeId)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="seg" style={{ margin: 0 }}>{(["retail", "supply"] as ProductKind[]).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{PRODUCT_KIND_LABEL[k]}</button>)}</div>
      </div>
      {canStart && (
        <div className="card">
          <b>新しい棚卸しを始める（{store?.name}　{PRODUCT_KIND_LABEL[kind]}）</b>
          <p className="sub" style={{ margin: "4px 0 8px" }}>このお店で使う商品の一覧が、そのまま棚卸し表になります。</p>
          <div className="actions"><label style={{ margin: 0 }}>棚卸日<input type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} /></label>
            <button style={{ width: "auto", margin: 0, alignSelf: "flex-end" }} onClick={async () => {
              try { const r = await api<{ id: string }>("/api/stocktakes", { storeId, kind, takenOn }); setMsg(""); setOpenId(r.id); } catch (e) { setMsg((e as Error).message); }
            }}>始める</button></div>
          {takenOn && <p className="sub" style={{ margin: "6px 0 0" }}>{reiwaDot(takenOn)} 棚卸</p>}
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
      <ul className="list">
        {list.map((s) => (
          <li key={s.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(s.id)}>
            <div><b>{reiwaDot(s.takenOn)} 棚卸</b> <span className="chip">{STOCKTAKE_LABEL[s.status]}</span>
              <div className="sub">入力済み {s.counted} / {s.lines}件</div></div>
            <b>{yen(s.total)}</b>
          </li>
        ))}
        {list.length === 0 && <p className="hint">まだ棚卸しがありません。</p>}
      </ul>
      </>}
    </>
  );
}

/** 合算: 棚卸日を選ぶと、お店ごとの「店販・業務・合計」と、全店の合計が出る */
function Summary({ stores, onOpen }: { stores: StoreRow[]; onOpen(id: string): void }) {
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [sum, setSum] = useState<StocktakeSummary | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { api<string[]>("/api/stocktakes?dates=1").then((d) => { setDates(d); setDate((c) => c || d[0] || ""); }); }, []);
  const load = useCallback(async () => { if (date) setSum(await api<StocktakeSummary>(`/api/stocktakes?summary=${date}`)); }, [date]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useAutoRefresh(() => { load().catch(() => {}); });
  const rows = stores.map((s) => ({ s, r: sum?.stores.find((x) => x.storeId === s.id) }));
  const cell = (p: { id: string; total: number; status: string; lines: number; counted: number } | null | undefined) =>
    p ? <button className="ghost linkcell" onClick={() => onOpen(p.id)}>{yen(p.total)}<small>{p.counted < p.lines ? ` 入力${p.counted}/${p.lines}` : STOCKTAKE_LABEL[p.status as "open"]}</small></button> : <span className="sub">未作成</span>;
  const tsv = () => ["お店\t店販\t業務\t合計", ...rows.map(({ s, r }) => [s.name, r?.retail?.total ?? "", r?.supply?.total ?? "", r?.total ?? ""].join("\t")), ["全店合計", sum?.retailTotal ?? 0, sum?.supplyTotal ?? 0, sum?.grandTotal ?? 0].join("\t")].join("\n");
  return (
    <>
      <h1 className="printonly" style={{ fontSize: 18 }}>{date ? reiwaDot(date) : ""} 棚卸金額（全店）</h1>
      <div className="toolbar noprint">
        <select aria-label="棚卸日" value={date} onChange={(e) => setDate(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{reiwaDot(d)} 棚卸</option>)}</select>
        <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => window.print()}>印刷</button>
        <button className="ghost" style={{ color: "var(--ink)" }} onClick={async () => setNote((await copyText(tsv())) ? "表をコピーしました" : "コピーできませんでした")}>表をコピー</button>
        {note && <span className="sub">{note}</span>}
      </div>
      {dates.length === 0 ? <p className="hint">まだ棚卸しがありません。</p> : (
        <div className="scroll"><table className="sttable sumtable">
          <thead><tr><th>お店</th><th>店販</th><th>業務</th><th>お店の合計</th></tr></thead>
          <tbody>
            {rows.map(({ s, r }) => <tr key={s.id}><td className="nm"><b>{s.name}</b></td><td className="r">{cell(r?.retail)}</td><td className="r">{cell(r?.supply)}</td><td className="r"><b>{r ? yen(r.total) : ""}</b></td></tr>)}
            <tr className="sumrow"><td>全店の合計</td><td className="r">{yen(sum?.retailTotal ?? 0)}</td><td className="r">{yen(sum?.supplyTotal ?? 0)}</td><td className="r"><b>{yen(sum?.grandTotal ?? 0)}</b></td></tr>
          </tbody>
        </table></div>
      )}
      <p className="hint noprint">店販は店販、業務は業務で計算し、お店ごとに合わせた金額と、全店の合計を出します。金額をタップすると、その棚卸し表が開きます。「入力◯/◯」は、数量の入力がまだ終わっていない棚卸しです。</p>
    </>
  );
}

function Detail({ id, storeName, onBack }: { id: string; storeName: string; onBack(): void }) {
  const { me } = useMe();
  const [d, setD] = useState<StocktakeDetail | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});      // 画面に出している値（lineId → 文字）
  const qtyRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef(new Map<string, string>());               // まだ保存していない入力（lineId → 値）
  const inflight = useRef<Promise<void>>(Promise.resolve());          // 保存の順番待ち（取りこぼし防止）
  const [saving, setSaving] = useState("");
  const [, bump] = useState(0);
  const [q, setQ] = useState(""); const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [msg, setMsg] = useState(""); const [note, setNote] = useState("");
  const [sameDay, setSameDay] = useState<StocktakeSummary | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((r: StocktakeDetail) => {
    setD(r);
    const n: Record<string, string> = {};
    for (const i of r.items) n[i.id] = dirtyRef.current.has(i.id) ? qtyRef.current[i.id] : i.quantity === null ? "" : String(i.quantity);
    qtyRef.current = n; setQty(n);
  }, []);
  const load = useCallback(async () => {
    const r = await api<StocktakeDetail>(`/api/stocktakes/${id}`);
    apply(r);
    api<StocktakeSummary>(`/api/stocktakes?summary=${r.takenOn}`).then(setSameDay).catch(() => {});
  }, [id, apply]);
  useEffect(() => { load().catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useAutoRefresh(() => { if (dirtyRef.current.size === 0 && !saving.startsWith("保存中")) load().catch(() => {}); });

  /** たまっている入力をすべて保存する。保存中に増えた入力も、順番に必ず保存される */
  const flush = useCallback((): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    inflight.current = inflight.current.then(async () => {
      const sent = new Map(dirtyRef.current);
      if (sent.size === 0) return;
      setSaving("保存中…");
      try {
        await api(`/api/stocktakes/${id}`, { action: "save", entries: [...sent].map(([lineId, v]) => ({ lineId, quantity: v.trim() === "" ? null : Number(v) })) });
        for (const [k, v] of sent) if (dirtyRef.current.get(k) === v) dirtyRef.current.delete(k);   // 保存中にまた変えた分は残す
        bump((n) => n + 1); setSaving("保存しました"); setMsg("");
        const r = await api<StocktakeDetail>(`/api/stocktakes/${id}`);
        setD(r);
      } catch (e) { setSaving(""); setMsg((e as Error).message); }
    });
    return inflight.current;
  }, [id]);

  const change = (lineId: string, raw: string) => {
    const v = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
    qtyRef.current = { ...qtyRef.current, [lineId]: v }; setQty(qtyRef.current);
    dirtyRef.current.set(lineId, v); setSaving("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, 700);
  };
  const step = (lineId: string, delta: number) => change(lineId, String(Math.max(0, Number(qtyRef.current[lineId] || 0) + delta)));

  const items = d?.items ?? [];
  const live = useMemo(() => items.map((i) => { const v = qty[i.id]; const n = v === undefined ? i.quantity : v === "" ? null : Number(v); return { ...i, quantity: n, amount: i.costPrice * (n ?? 0) }; }), [items, qty]);
  const total = live.reduce((a, i) => a + i.amount, 0);
  const counted = live.filter((i) => i.quantity !== null).length;
  const shown = live.filter((i) => (!onlyEmpty || i.quantity === null) && (!q || `${i.maker}${i.name}${i.spec}`.toLowerCase().includes(q.toLowerCase())));
  if (!d) return null;
  const title = `【店舗名　${storeName}　】　${PRODUCT_KIND_LABEL[d.kind]}　${reiwaDot(d.takenOn)} 棚卸`;
  const run = async (body: object, ok = "") => { try { await flush(); const r = await api<Record<string, unknown>>(`/api/stocktakes/${id}`, body); setMsg(""); setNote(typeof r.added === "number" ? `${r.added}件を追加しました` : ok); await load(); return true; } catch (e) { setMsg((e as Error).message); return false; } };
  const tsv = () => ["メーカー\t品名\t規格\t仕入値\t数量\t金額", ...live.map((i) => [i.maker, i.name, i.spec, i.costPrice, i.quantity ?? "", i.amount].join("\t")), `\t\t\t\t${reiwaDot(d.takenOn)} 棚卸金額\t${total}`].join("\n");

  return (
    <>
      <button className="ghost noprint" style={{ color: "var(--blue)", padding: 0 }} onClick={async () => { await flush(); onBack(); }}>← 棚卸しの一覧へ</button>
      <h1 className="noprint" style={{ fontSize: 22 }}>{title}</h1>
      <h1 className="printonly" style={{ fontSize: 18 }}>{title}</h1>
      <p className="sub noprint" style={{ margin: "0 0 8px" }}>{STOCKTAKE_LABEL[d.status]}　入力済み {counted} / {live.length}件　{saving && <b style={{ color: "var(--ink)" }}>{saving}</b>}</p>
      <div className="actions noprint" style={{ marginBottom: 10 }}>
        {d.editable && d.canManage && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => run({ action: "sync" })}>商品を追加（新しく増えた分）</button>}
        {d.canManage && d.status === "open" && <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => confirm("棚卸しをオフィスに提出しますか？（提出後は店長は直せません）") && run({ action: "status", status: "submitted" })}>オフィスに提出する</button>}
        {me.level === 4 && d.status === "submitted" && <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => run({ action: "status", status: "acknowledged" })}>確認済みにする</button>}
        {me.level === 4 && d.status !== "open" && <button className="ghost" style={{ color: "var(--sub)" }} onClick={() => confirm("ひとつ前の状態に戻しますか？") && run({ action: "status", status: d.status === "acknowledged" ? "submitted" : "open" })}>ひとつ戻す</button>}
        <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => window.print()}>印刷</button>
        <button className="ghost" style={{ color: "var(--ink)" }} onClick={async () => setNote((await copyText(tsv())) ? "表をコピーしました（Excelやメールにはりつけできます）" : "コピーできませんでした")}>表をコピー</button>
        {d.canManage && d.status === "open" && <button className="ghost" onClick={async () => { if (confirm("この棚卸しを削除しますか？（入力した数量も消えます）") && (await run({ action: "delete" }))) onBack(); }}>削除</button>}
        {note && <span className="sub">{note}</span>}
      </div>
      {msg && <p className="err">{msg}</p>}
      <div className="toolbar noprint">
        <input aria-label="さがす" placeholder="メーカー・品名でさがす" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
        <label className="sub" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />未入力だけ表示</label>
      </div>

      <div className="scroll"><table className="sttable">
        <thead><tr><th className="maker">メーカー</th><th>品名</th><th className="spec">規格</th><th>仕入値</th><th>数量</th><th>金額</th></tr></thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.id} className={i.quantity === null ? "empty" : ""}>
              <td className="maker">{i.maker}</td>
              <td className="nm">{i.name}<div className="sub subline">{[i.maker, i.spec].filter(Boolean).join("　")}</div></td>
              <td className="spec">{i.spec}</td>
              <td className="r">{i.costPrice.toLocaleString("ja-JP")}</td>
              <td className="q">
                {d.editable ? (
                  <span className="stepper">
                    <button type="button" aria-label="減らす" onClick={() => step(i.id, -1)}>−</button>
                    <input inputMode="numeric" aria-label={`${i.name}の数量`} value={qty[i.id] ?? ""} placeholder="—" onChange={(e) => change(i.id, e.target.value)} onBlur={() => { flush(); }} />
                    <button type="button" aria-label="増やす" onClick={() => step(i.id, 1)}>＋</button>
                  </span>
                ) : <b>{i.quantity ?? "—"}</b>}
              </td>
              <td className="r">{i.amount ? i.amount.toLocaleString("ja-JP") : i.quantity === null ? "" : "0"}</td>
            </tr>
          ))}
          <tr className="sumrow"><td className="maker"></td><td colSpan={1}>{reiwaDot(d.takenOn)} 棚卸金額</td><td className="spec"></td><td></td><td></td><td className="r"><b>{yen(total)}</b></td></tr>
        </tbody>
      </table></div>
      {(() => {
        const me2 = sameDay?.stores.find((x) => x.storeId === d.storeId);
        if (!me2) return null;
        const other = d.kind === "retail" ? me2.supply : me2.retail;
        const mine = total;                                   // いま入力中の金額を反映
        const otherTotal = other?.total ?? 0;
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <b>このお店の合算（{reiwaDot(d.takenOn)}）</b>
            <div className="sub">{PRODUCT_KIND_LABEL[d.kind]} {yen(mine)} ＋ {PRODUCT_KIND_LABEL[d.kind === "retail" ? "supply" : "retail"]} {other ? yen(otherTotal) : "（未作成）"}</div>
            <div className="big" style={{ fontSize: 24 }}>{yen(mine + otherTotal)}</div>
          </div>
        );
      })()}
      <p className="hint noprint">数量は整数で入れます（ない商品は 0）。入力すると自動で保存されます。金額 = 仕入値 × 数量 で、合計が棚卸金額です。仕入値は、棚卸しを始めた時点の値で固定されます。</p>
    </>
  );
}
