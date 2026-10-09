"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PrintButton } from "@/app/PrintButton";
import { Stepper } from "@/app/Stepper";
import { DateStepper } from "@/app/DateStepper";
import { ShareMenu } from "@/app/ShareMenu";
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
  const [openId, setOpenIdRaw] = useState<string | null>(null);
  // 開いている棚卸し表を、リンク（?id=）にも入れる（メールで送ったリンクから、そのまま開けるように）
  const setOpenId = useCallback((id: string | null) => { setOpenIdRaw(id); try { history.replaceState(null, "", id ? `${location.pathname}?id=${id}` : location.pathname); } catch { /* 無視 */ } }, []);
  useEffect(() => { const id = new URLSearchParams(location.search).get("id"); if (id) setOpenIdRaw(id); }, []);
  const [view, setView] = useState<"list" | "summary">("list");
  const [takenOn, setTakenOn] = useState(monthEnd());
  const [msg, setMsg] = useState("");
  const [imp, setImp] = useState<{ text: string; date: string; busy: boolean; res: string } | null>(null);
  const store = stores.find((s) => s.id === storeId);
  const canStart = !me.displayOnly && (me.level === 4 || storeId === me.storeId);

  useEffect(() => { api<StoreRow[]>("/api/stores").then((s) => setStores(s.filter((x) => x.status === "active"))); }, []);
  const loadList = useCallback(async () => { setList(await api<StocktakeRow[]>(`/api/stocktakes?storeId=${storeId}&kind=${kind}`)); }, [storeId, kind]);
  useEffect(() => { if (!openId) loadList().catch(() => {}); }, [loadList, openId]);
  useAutoRefresh(() => { if (!openId) loadList().catch(() => {}); });

  if (openId) return <Detail id={openId} storeName={store?.name ?? ""} onBack={() => setOpenId(null)} />;
  return (
    <>
      <h1>棚卸し</h1>
      <div className="card" style={{ marginBottom: 10 }}>
        <b>棚卸しのやり方（3ステップ）</b>
        <ol style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: 1.7 }}>
          <li>下で、<b>お店</b>と<b>店販／業務</b>をえらび、<b>「始める」</b>を押す</li>
          <li>商品ごとに、<b>数</b>を入れる（＋ − ボタンでも入ります。自動で保存されます）</li>
          <li>全部入れたら、<b>「提出する」</b>を押す（店長・事務員さん）</li>
        </ol>
        <p style={{ margin: "8px 0 0" }}>商品が足りないときは、棚卸し表を開いて、その中の<b>「＋ 商品を追加する」</b>で、だれでも入れられます。</p>
      </div>
      <div className="seg"><button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>棚卸し表（お店・種類ごと）</button><button className={view === "summary" ? "on" : ""} onClick={() => setView("summary")}>合算（店販・業務・全店）</button></div>
      {view === "summary" ? <Summary stores={me.level >= 3 ? stores : stores.filter((s) => s.id === me.storeId)} onOpen={(id) => { setOpenId(id); }} /> : <>
      <div className="toolbar">
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{(me.level >= 3 ? stores : stores.filter((s) => s.id === me.storeId)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="seg" style={{ margin: 0 }}>{(["retail", "supply"] as ProductKind[]).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{PRODUCT_KIND_LABEL[k]}</button>)}</div>
      </div>
      {canStart && (
        <div className="card">
          <b>新しい棚卸しを始める（{store?.name}　{PRODUCT_KIND_LABEL[kind]}）</b>
          <p className="sub" style={{ margin: "4px 0 8px" }}>このお店で使う商品の一覧が、そのまま棚卸し表になります。前回の棚卸しがあれば、棚卸し表の中の「数量を今年にまとめてコピー」で、昨年の数をそのまま入れられます（1つずつ直せます）。</p>
          <div className="actions"><div style={{ margin: 0 }}><span className="sub">棚卸日</span><br /><DateStepper label="棚卸日" value={takenOn} onChange={setTakenOn} /></div>
            <button style={{ width: "auto", margin: 0, alignSelf: "flex-end" }} onClick={async () => {
              try { const r = await api<{ id: string }>("/api/stocktakes", { storeId, kind, takenOn }); setMsg(""); setOpenId(r.id); } catch (e) { setMsg((e as Error).message); }
            }}>始める</button></div>
          {takenOn && <p className="sub" style={{ margin: "6px 0 0" }}>{reiwaDot(takenOn)} 棚卸</p>}
        </div>
      )}
      {me.level === 4 && (
        <div className="card">
          <b>昨年のデータを取り込む（{store?.name}　{PRODUCT_KIND_LABEL[kind]}）</b>
          {!imp ? <div style={{ marginTop: 6 }}><button className="ghost" style={{ width: "auto" }} onClick={() => setImp({ text: "", date: "2025-10-31", busy: false, res: "" })}>取り込み画面をひらく</button>
            <p className="sub" style={{ margin: "6px 0 0" }}>昨年の「メーカー・品名・規格・仕入値・数量」の表を貼ると、今年の棚卸しが、その数量から始まります（数量を直して提出します。金額は数量を変えると自動で変わります）。</p></div> : (
            <div style={{ marginTop: 6 }}>
              <div style={{ margin: 0 }}><span className="sub">昨年の棚卸日</span><br /><DateStepper label="昨年の棚卸日" value={imp.date} onChange={(v) => setImp({ ...imp, date: v })} /></div>
              <textarea aria-label="昨年の表" rows={8} placeholder={"Excelの表をコピーして貼り付け\n・全店まとめて：店舗名 区分 メーカー 品名 規格 単価 数量 金額 備考（見出しの行ごと貼る）\n・1つのお店だけ：メーカー 品名 規格 仕入値 数量"} style={{ width: "100%", fontSize: 14, padding: 10, borderRadius: 12, border: "1px solid var(--line)", marginTop: 6 }} value={imp.text} onChange={(e) => setImp({ ...imp, text: e.target.value })} />
              {imp.res && <p className="sub" style={{ color: "var(--ok)" }}>✅ {imp.res}</p>}
              <div className="actions">
                <button disabled={imp.busy || !imp.text.trim() || !imp.date} onClick={async () => {
                  setImp({ ...imp, busy: true, res: "" });
                  try {
                    if (/^店舗名/.test(imp.text.trim())) {
                      const r = await api<{ groups: { store: string; kind: ProductKind; lines: number; total: number; error?: string }[]; bad: number }>("/api/stocktakes", { action: "import-all", storeId, kind, takenOn: imp.date, text: imp.text }); setMsg("");
                      setImp({ ...imp, busy: false, text: "", res: r.groups.map((g) => `${g.store}（${PRODUCT_KIND_LABEL[g.kind]}）：${g.error ? `⚠ ${g.error}` : `${g.lines}行・${g.total.toLocaleString("ja-JP")}円`}`).join(" ／ ") + (r.bad ? `　読めなかった行 ${r.bad}` : "") });
                    } else {
                      const r = await api<{ lines: number; created: number; bad: number; total: number }>("/api/stocktakes", { action: "import", storeId, kind, takenOn: imp.date, text: imp.text }); setMsg("");
                      setImp({ ...imp, busy: false, text: "", res: `${r.lines}行を取り込みました（新しい商品 ${r.created}件・合計 ${r.total.toLocaleString("ja-JP")}円${r.bad ? `・読めなかった行 ${r.bad}` : ""}）` });
                    }
                    await loadList(); }
                  catch (e) { setMsg((e as Error).message); setImp({ ...imp, busy: false }); }
                }}>取り込む</button>
                <button className="ghost" onClick={() => setImp(null)}>閉じる</button>
              </div>
            </div>)}
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
        <ShareMenu title={`${date ? reiwaDot(date) : ""} 棚卸金額（全店）`} text={tsv()} />
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
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ maker: "", name: "", spec: "", cost: "" });
  const [el, setEl] = useState<{ id: string; maker: string; name: string; spec: string; cost: string } | null>(null);

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
      <div className="card noprint" style={{ margin: "0 0 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span><span className="chip">{STOCKTAKE_LABEL[d.status]}</span>　入力済み <b>{counted}</b> / {live.length}件</span>
          <span className="sub">{saving && <b style={{ color: "var(--ink)" }}>{saving}</b>}</span>
        </div>
        <div style={{ height: 8, background: "var(--line, #e5e5e5)", borderRadius: 4, margin: "8px 0" }}><div style={{ height: 8, width: `${live.length ? Math.round((counted / live.length) * 100) : 0}%`, background: "var(--blue, #2563eb)", borderRadius: 4 }} /></div>
        <p style={{ margin: 0 }}>
          {live.length === 0 ? <b>この表には、まだ商品がありません。</b>
            : d.status !== "open" ? <>この棚卸しは「{STOCKTAKE_LABEL[d.status]}」です。{d.editable ? "数を直せます。" : "数は直せません（見るだけ）。"}</>
            : counted < live.length ? <>商品ごとの<b>数</b>を入れてください（ない商品は <b>0</b>）。入れた分は、自動で保存されます。<b>黄色</b>の商品が、まだ入っていません。</>
            : <>全部入りました。{d.canManage ? <b>上の「提出する」を押してください。</b> : "店長が提出します。"}</>}
        </p>
        {live.length === 0 && <p style={{ margin: "8px 0 0" }}>下の「＋ 商品を追加する」から、この画面で商品を入れられます。</p>}
      </div>
      <div className="actions noprint" style={{ marginBottom: 10 }}>
        {d.editable && d.canManage && <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => run({ action: "sync" })}>商品を追加（新しく増えた分）</button>}
        {d.canManage && d.status === "open" && <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => confirm("棚卸しをオフィスに提出しますか？（提出後は店長は直せません）") && run({ action: "status", status: "submitted" })}>オフィスに提出する</button>}
        {me.level === 4 && d.status === "submitted" && <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} onClick={() => run({ action: "status", status: "acknowledged" })}>確認済みにする</button>}
        {me.level === 4 && d.status !== "open" && <button className="ghost" style={{ color: "var(--sub)" }} onClick={() => confirm("ひとつ前の状態に戻しますか？") && run({ action: "status", status: d.status === "acknowledged" ? "submitted" : "open" })}>ひとつ戻す</button>}
        {d.canManage && d.status !== "open" && <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => { try { const r = await api<{ count: number }>("/api/stock", { action: "apply", stocktakeId: id }); setMsg(""); setNote(`在庫に反映しました（${r.count}件の差を合わせました）`); } catch (e) { setMsg((e as Error).message); } }}>この棚卸しを在庫に反映</button>}
        {d.editable && d.prevOn && <button className="ghost" style={{ color: "var(--blue)" }} onClick={async () => {
          const filled = live.some((i) => i.quantity !== null);
          const onlyEmpty = filled ? !confirm(`すでに入っている数量も、${reiwaDot(d.prevOn!)} の数でおきかえますか？\n［OK］おきかえる　［キャンセル］空いている所だけコピー`) : false;
          try { await flush(); const r = await api<{ copied: number; added: number; from: string | null }>(`/api/stocktakes/${id}`, { action: "copy-prev", onlyEmpty }); setMsg(""); setNote(`${reiwaDot(r.from ?? d.prevOn!)} の数量を ${r.copied}件コピーしました${r.added ? `（表にない商品 ${r.added}件も足しました）` : ""}。1つずつ直せます`); await load(); } catch (e) { setMsg((e as Error).message); }
        }}>📋 {reiwaDot(d.prevOn)} の数量を、今年にまとめてコピー</button>}
        <PrintButton label="🖨 A4に1枚で印刷" fit=".stwide .sttable" />
        <ShareMenu title={title} text={tsv()} link={`${typeof location !== "undefined" ? location.origin : ""}/admin/stocktake?id=${id}`} />
        {d.canManage && d.status === "open" && <button className="ghost" onClick={async () => { if (confirm("この棚卸しを削除しますか？（入力した数量も消えます）") && (await run({ action: "delete" }))) onBack(); }}>削除</button>}
        {note && <span className="sub">{note}</span>}
      </div>
      {msg && <p className="err">{msg}</p>}
      {d.editable && (
        <div className="card noprint" style={{ margin: "0 0 10px" }}>
          {!adding
            ? <button className="ghost" style={{ color: "var(--blue)", padding: 0, fontWeight: 700 }} onClick={() => setAdding(true)}>＋ 商品を追加する（この表にすぐ入ります）</button>
            : <>
              <b>商品を追加（{PRODUCT_KIND_LABEL[d.kind]}・{storeName}）</b>
              <div className="actions" style={{ marginTop: 8, flexWrap: "wrap" }}>
                <input aria-label="メーカー" placeholder="メーカー（なくてもOK）" value={nf.maker} onChange={(e) => setNf({ ...nf, maker: e.target.value })} style={{ flex: 1, minWidth: 130 }} />
                <input aria-label="品名" placeholder="品名" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} style={{ flex: 2, minWidth: 160 }} />
                <input aria-label="規格" placeholder="規格（なくてもOK）" value={nf.spec} onChange={(e) => setNf({ ...nf, spec: e.target.value })} style={{ flex: 1, minWidth: 110 }} />
                <Stepper label="仕入値" placeholder="仕入値（税抜・円）" unit="円" step={10} bigStep={100} max={9999999} value={nf.cost} onChange={(x) => setNf({ ...nf, cost: x })} />
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }} disabled={!nf.name.trim() || nf.cost === ""} onClick={async () => {
                  try {
                    await flush();
                    await api("/api/products", { kind: d.kind, items: [{ maker: nf.maker.trim(), name: nf.name.trim(), spec: nf.spec.trim(), costPrice: Number(nf.cost) }], storeIds: [d.storeId] });
                    setNf({ maker: "", name: "", spec: "", cost: "" });
                    await run({ action: "sync" });
                    setNote(`「${nf.name.trim()}」を追加しました。数を入れてください`);
                  } catch (e) { setMsg((e as Error).message); }
                }}>追加して表に入れる</button>
                <button className="ghost" onClick={() => setAdding(false)}>閉じる</button>
              </div>
              <p className="sub" style={{ margin: "6px 0 0" }}>このお店の{PRODUCT_KIND_LABEL[d.kind]}の商品として登録され、そのまま棚卸し表に入ります。たくさん入れるときや写真から読み込むときは<a href="/admin/products">商品一覧</a>へ。</p>
            </>}
        </div>
      )}
      {el && typeof document !== "undefined" && createPortal(
        <div className="sheet-bg noprint" onClick={() => setEl(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="この行を直す">
            <h3>この行を直す</h3>
            <label>メーカー<input value={el.maker} onChange={(e) => setEl({ ...el, maker: e.target.value })} /></label>
            <label>品名<input value={el.name} onChange={(e) => setEl({ ...el, name: e.target.value })} /></label>
            <label>規格<input value={el.spec} onChange={(e) => setEl({ ...el, spec: e.target.value })} /></label>
            <label>仕入値（税抜・円）<Stepper label="仕入値" unit="円" step={10} bigStep={100} max={9999999} value={el.cost} onChange={(x) => setEl({ ...el, cost: x })} /></label>
            <p className="sub">この棚卸し表の中だけが変わります。数量を入れていれば、金額も自動で変わります。</p>
            <div className="toolbar">
              <button disabled={!el.name.trim() || el.cost === ""} onClick={async () => { try { await flush(); await api(`/api/stocktakes/${id}`, { action: "edit-line", lineId: el.id, maker: el.maker, name: el.name, spec: el.spec, costPrice: Number(el.cost) }); setEl(null); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); } }}>直す</button>
              {d.canManage && <button className="ghost" style={{ color: "var(--bad)" }} onClick={async () => { if (!confirm("この行を、この表から消しますか？（数量も消えます）")) return; try { await flush(); await api(`/api/stocktakes/${id}`, { action: "delete-line", lineId: el.id }); setEl(null); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); } }}>この行を消す</button>}
              <button className="ghost" onClick={() => setEl(null)}>やめる</button>
            </div>
          </div>
        </div>, document.body)}
      <div className="toolbar noprint">
        <input aria-label="さがす" placeholder="メーカー・品名でさがす" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
        <label className="sub" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />未入力だけ表示</label>
      </div>

      <ul className="stcards noprint">
        {shown.map((i) => (
          <li key={i.id} className={i.quantity === null ? "empty" : ""}>
            <div className="stinfo"><b>{i.name}</b><span className="sub">{[i.maker, i.spec].filter(Boolean).join("　")}　仕入値 {i.costPrice.toLocaleString("ja-JP")}円</span></div>
            <div className="stctl">
              {d.editable ? (
                <Stepper label={`${i.name}の数量`} placeholder="数" step={1} value={qty[i.id] ?? ""} onChange={(x) => change(i.id, x)} />
              ) : <b style={{ fontSize: 20 }}>{i.quantity ?? "—"}</b>}
              <span className="sub">{i.quantity === null ? "" : `${i.amount.toLocaleString("ja-JP")}円`}</span>
              {d.editable && <button type="button" className="ghost" style={{ padding: "2px 8px", fontSize: 12, margin: 0, width: "auto" }} onClick={() => setEl({ id: i.id, maker: i.maker, name: i.name, spec: i.spec, cost: String(i.costPrice) })}>名前・仕入値を直す</button>}
            </div>
          </li>
        ))}
        {shown.length === 0 && live.length > 0 && <p className="hint">該当する商品がありません。</p>}
      </ul>
      <div className="scroll stwide"><table className="sttable">
        <thead><tr><th className="maker">メーカー</th><th>品名</th><th className="spec">規格</th><th>仕入値</th><th>数量</th><th>金額</th>{d.editable && <th className="noprint"></th>}</tr></thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.id} className={i.quantity === null ? "empty" : ""}>
              <td className="maker">{i.maker}</td>
              <td className="nm">{i.name}<div className="sub subline">{[i.maker, i.spec].filter(Boolean).join("　")}</div></td>
              <td className="spec">{i.spec}</td>
              <td className="r">{i.costPrice.toLocaleString("ja-JP")}</td>
              <td className="q">
                {d.editable ? (
                  <Stepper className="cellstp" label={`${i.name}の数量`} placeholder="—" step={1} value={qty[i.id] ?? ""} onChange={(x) => change(i.id, x)} />
                ) : <b>{i.quantity ?? "—"}</b>}
              </td>
              <td className="r">{i.amount ? i.amount.toLocaleString("ja-JP") : i.quantity === null ? "" : "0"}</td>
              {d.editable && <td className="noprint"><button type="button" className="ghost" style={{ padding: "2px 8px", fontSize: 12, margin: 0, width: "auto" }} onClick={() => setEl({ id: i.id, maker: i.maker, name: i.name, spec: i.spec, cost: String(i.costPrice) })}>直す</button></td>}
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
