"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Stepper } from "@/app/Stepper";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import type { CommuteData, CommuteMatch } from "@/lib/service";

const ymj = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
const ST: Record<string, string> = { none: "⚪ まだ", submitted: "🟡 提出ずみ（確認まち）", checked: "✅ 確認ずみ", redo: "🔴 出し直し" };
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const ml = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
/** 写真を小さくして（長い辺1280px・JPEG）、データにする */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.78);
}

function Page() {
  const { me } = useMe();
  const [month, setMonth] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("");
  const [d, setD] = useState<CommuteData | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null); const [viewImg, setViewImg] = useState("");
  const [note, setNote] = useState("");
  const [months, setMonths] = useState(0);
  const [due, setDue] = useState("");
  const [paste, setPaste] = useState(""); const [ms, setMs] = useState<CommuteMatch[] | null>(null); const [pick, setPick] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    try { const r = await api<CommuteData>(`/api/commute?${month ? `month=${month}&` : ""}${storeId ? `storeId=${storeId}` : ""}`); setD(r); setDue((v) => v || String(r.dueDay)); if (!month) setMonth(r.month); if (!storeId) setStoreId(r.storeId); setMsg(""); }
    catch (e) { setMsg((e as Error).message); }
  }, [month, storeId]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  const act = async (body: object, done = "") => { setBusy(true); try { await api("/api/commute", body); setMsg(done); await load(); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  const open = async (id: string) => { setView(id); setViewImg(""); setNote(""); try { setViewImg((await api<{ image: string }>(`/api/commute?image=${id}`)).image); } catch (e) { setMsg((e as Error).message); } };
  if (!d || !month) return <main><Link href="/home" className="back">← ホーム</Link><h1>定期券の提出</h1>{msg && <p className="err">{msg}</p>}</main>;
  const cur = d.month;
  return (
    <main>
      <Link href="/home" className="back">← ホーム</Link>
      <h1>定期券の提出</h1>
      <p className="hint">定期券を買っている人が、毎月1回、定期券の写真を出します。正美さんが確認します。毎月 <b>{d.dueDay}日</b> までに出してください。</p>
      <div className="seg" style={{ marginBottom: 8 }}>
        <button onClick={() => setMonth(shiftMonth(cur, -1))}>‹ 前の月</button>
        <button className="on">{ml(cur)}</button>
        <button onClick={() => setMonth(shiftMonth(cur, 1))}>次の月 ›</button>
      </div>

      {d.onRoster && (
        <div className="card">
          <b style={{ fontSize: 18 }}>あなたの提出（{ml(cur)}ぶん）</b>
          <p style={{ margin: "6px 0" }}>{d.mine ? ST[d.mine.status] : d.coveredUntil ? `🟦 今月は出さなくて大丈夫です（${ymj(d.coveredUntil)}まで、前に出した定期券の期間です）` : d.overdue ? "🔴 期限（" + d.dueDate.slice(5).replace("-", "/") + "）をすぎています。早めに出してください" : "⚪ まだ出していません（" + d.dueDate.slice(5).replace("-", "/") + " まで）"}</p>
          {d.mine?.status === "redo" && <p className="err">{d.mine.note || "写真が見づらいなど、出し直しをお願いします。"}</p>}
          {d.mine?.status === "checked" ? <p className="sub">確認ずみです。ありがとうございました。</p> : (
            <>
            <div className="sub" style={{ margin: "4px 0" }}>何ヶ月分の定期券ですか？（先にえらびます）</div>
            <div className="seg" style={{ marginBottom: 8 }}>
              {[1, 3, 6].map((n) => <button key={n} className={months === n || (!months && d.mine?.months === n) ? "on" : ""} onClick={() => setMonths(n)}>{n}ヶ月</button>)}
            </div>
            <label className="btn" style={{ display: "block", textAlign: "center", padding: 14, borderRadius: 14, background: "var(--blue)", color: "#fff", fontWeight: 700, cursor: "pointer", opacity: (months || d.mine?.months) ? 1 : 0.5 }}>
              {busy ? "送っています…" : d.mine ? "📷 写真を出し直す" : "📷 定期券を撮って出す"}
              <input type="file" accept="image/*" capture="environment" hidden disabled={busy || !(months || d.mine?.months)} onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                setBusy(true);
                try { const image = await shrink(f); await api("/api/commute", { action: "submit", month: cur, image, months: months || d.mine?.months }); setMsg("出しました。ありがとうございます"); await load(); } catch (er) { setMsg((er as Error).message); }
                setBusy(false);
              }} />
            </label>
            </>
          )}
          {d.mine && <button className="ghost" style={{ marginTop: 8 }} onClick={() => open(d.mine!.id)}>出した写真を見る</button>}
          <p className="sub" style={{ margin: "6px 0 0" }}>出せるのは、今月と先月ぶんだけです。写真は3か月で自動で消えます。</p>
        </div>
      )}
      {!d.onRoster && !d.canManage && <p className="hint">あなたは、定期券を出す名簿に入っていません。</p>}

      {d.canManage && (
        <>
          {d.stores.length > 1 && (
            <select aria-label="お店" value={d.storeId} onChange={(e) => setStoreId(e.target.value)} style={{ margin: "8px 0" }}>
              {d.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <h3 style={{ margin: "12px 0 4px" }}>名簿と提出の状況（{ml(cur)}）</h3>
          <p className="sub">提出ずみ {d.rows.filter((r) => (r.status !== "none" && r.status !== "redo") || r.coveredUntil).length}／{d.rows.length}人（3・6ヶ月定期の人は、その期間は出さなくてOK）</p>
          {d.rows.length === 0 && <p className="hint">名簿が空です。下の「名簿に入れる」で、定期券を買っている人を入れてください。</p>}
          <ul className="list">
            {d.rows.map((r) => (
              <li key={r.membershipId} style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span><b>{r.name}</b> <span className="sub">{r.status === "none" && r.coveredUntil ? `🟦 出さなくてOK（${ymj(r.coveredUntil)}まで）` : ST[r.status]}{r.months ? `・${r.months}ヶ月分` : ""}</span></span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {d.canCheck && r.subId && <button className="ghost" style={{ width: "auto", margin: 0, color: "var(--blue)" }} onClick={() => open(r.subId!)}>写真を見る</button>}
                    <button className="ghost" style={{ width: "auto", margin: 0, color: "var(--sub)" }} disabled={busy} onClick={() => confirm(`${r.name}さんを名簿から外しますか？（退職・やめたとき）`) && act({ action: "roster", memberId: r.membershipId, on: false }, "名簿から外しました")}>外す</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <details style={{ marginTop: 8 }}>
            <summary>📋 名前をまとめて貼って、名簿に入れる</summary>
            <p className="sub">名前を1行ずつ貼ります（お店の名前の行があれば、そのお店の人から探します）。照合してから、確認して入れます。</p>
            <textarea rows={6} value={paste} onChange={(e) => { setPaste(e.target.value); setMs(null); }} placeholder={"天神店\n中嶋\n金子直樹\n六本松店\n本山"} />
            <button disabled={busy || !paste.trim()} onClick={async () => { setBusy(true); try { const r = await api<{ matches: CommuteMatch[] }>("/api/commute", { action: "match", text: paste }); setMs(r.matches); setPick(Object.fromEntries(r.matches.map((m, i) => [i, m.matches.length === 1 ? m.matches[0].id : ""]))); } catch (e) { setMsg((e as Error).message); } setBusy(false); }}>照合する</button>
            {ms && (
              <>
                <ul className="list">
                  {ms.map((m, i) => (
                    <li key={i} style={{ display: "block" }}>
                      <b>{m.token}</b>{m.storeHint ? <span className="sub">（{m.storeHint}）</span> : null}
                      {m.matches.length === 0 ? <span className="err"> → 見つかりません</span> : (
                        <select value={pick[i] ?? ""} onChange={(e) => setPick({ ...pick, [i]: e.target.value })} style={{ marginTop: 4 }}>
                          <option value="">（入れない）</option>
                          {m.matches.map((x) => <option key={x.id} value={x.id}>{x.name}（{x.storeName}）{x.already ? " ・もう名簿にいます" : ""}</option>)}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
                <button disabled={busy || !Object.values(pick).some(Boolean)} onClick={async () => { setBusy(true); try { const r = await api<{ count: number }>("/api/commute", { action: "roster-bulk", ids: Object.values(pick).filter(Boolean) }); setMsg(`${r.count}人を名簿に入れました`); setMs(null); setPaste(""); await load(); } catch (e) { setMsg((e as Error).message); } setBusy(false); }}>選んだ{Object.values(pick).filter(Boolean).length}人を、名簿に入れる</button>
              </>
            )}
          </details>
          {d.candidates.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary>＋ 名簿に入れる（新しく買った人・新入社員）</summary>
              <ul className="list">
                {d.candidates.map((c) => <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>{c.name}</span><button style={{ width: "auto", margin: 0, padding: "6px 12px" }} disabled={busy} onClick={() => act({ action: "roster", memberId: c.id, on: true }, `${c.name}さんを名簿に入れました`)}>入れる</button></li>)}
              </ul>
            </details>
          )}
          {d.canCheck && (
            <div className="card" style={{ marginTop: 12 }}>
              <b>提出の期限日（毎月）</b>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Stepper label="期限日" unit="日まで" min={1} max={28} value={due} onChange={setDue} />
                <button style={{ width: "auto", margin: 0 }} disabled={busy || !due} onClick={() => act({ action: "due", day: Number(due) }, "期限日を決めました")}>決める</button>
              </div>
              <p className="sub">期限の3日前から、まだ出していない人の携帯に、毎日通知が届きます（期限をすぎても、出すまで続きます）。</p>
            </div>
          )}
        </>
      )}
      {msg && <p className={/出しました|外しました|入れました|決めました|確認/.test(msg) ? "hint" : "err"}>{msg}</p>}

      {view && createPortal(
        <div className="sheet-bg" onClick={() => setView(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="定期券の写真" style={{ maxHeight: "90vh", overflow: "auto" }}>
            {viewImg ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={viewImg} alt="定期券" style={{ width: "100%", borderRadius: 12 }} /> : <p className="sub">読みこみ中…</p>}
            {d.canCheck && d.rows.find((r) => r.subId === view) && (
              <>
                <input placeholder="出し直しのとき、理由（任意）" value={note} onChange={(e) => setNote(e.target.value)} style={{ margin: "8px 0" }} />
                <div style={{ display: "grid", gap: 8 }}>
                  <button disabled={busy} onClick={async () => { await act({ action: "check", id: view, status: "checked" }, "確認ずみにしました"); setView(null); }}>確認ずみにする</button>
                  <button className="ghost" disabled={busy} style={{ color: "#d70015" }} onClick={async () => { await act({ action: "check", id: view, status: "redo", note }, "出し直しをお願いしました"); setView(null); }}>出し直しをお願いする</button>
                </div>
              </>
            )}
            <button className="ghost" style={{ color: "var(--ink)", width: "100%", marginTop: 8 }} onClick={() => setView(null)}>閉じる</button>
          </div>
        </div>, document.body)}
    </main>
  );
}
export default function CommutePage() { return <MeProvider><Page /></MeProvider>; }
