"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { reiwa } from "@/lib/era";
import { LEVEL_NAMES, type Level } from "@/lib/permissions";
import { parseStaffPaste } from "@/lib/staff-paste";
import type { BulkStaffResult } from "@/lib/service";
import type { StaffRow } from "@/lib/service";

type Store = { id: string; name: string; status: "active" | "closed" };
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}
const LEVELS: Level[] = [1, 2, 3, 4];
const ago = (sec: number | null | undefined) => sec == null ? "" : sec < 90 ? "いま" : sec < 3600 ? `${Math.round(sec / 60)}分前` : sec < 86400 ? `${Math.round(sec / 3600)}時間前` : `${Math.round(sec / 86400)}日前`;
function PresenceBadge({ s }: { s: StaffRow }) {
  if (!s.presence) return null;
  const m = {
    online: { dot: "#1e9e4a", text: "オンライン（いま開いています）" },
    idle: { dot: "#e0a100", text: `ログイン済み（開いていません${s.seenAgoSec != null ? `・最後 ${ago(s.seenAgoSec)}` : ""}）` },
    loggedout: { dot: "#8e8e93", text: `ログアウト済み（オフライン${s.seenAgoSec != null ? `・最後 ${ago(s.seenAgoSec)}` : ""}）` },
    never: { dot: "#d70015", text: "まだログインしていません" },
  }[s.presence];
  return <div className="sub" style={{ marginTop: 2 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: m.dot, marginRight: 6 }} />{m.text}</div>;
}

export default function StaffPage() {
  const { me } = useMe();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [form, setForm] = useState({ name: "", employeeCode: "", storeId: me.storeId, level: 1 as Level, displayOnly: false });
  const [msg, setMsg] = useState("");
  const [bulk, setBulk] = useState<{ text: string; storeId: string } | null>(null);
  const [bulkDone, setBulkDone] = useState<BulkStaffResult[] | null>(null);
  const [bulkMsg, setBulkMsg] = useState(""); const [bulkBusy, setBulkBusy] = useState(false); const [bulkNote, setBulkNote] = useState("");
  const [issued, setIssued] = useState<{ name: string; passcode: string } | null>(null);

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([api<StaffRow[]>("/api/staff"), api<Store[]>("/api/stores")]);
    setStaff(s); setStores(st);
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 15);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const canRegister = me.level >= 3;
  const registrableStores = (me.level === 4 ? stores : stores.filter((s) => s.id === me.storeId)).filter((s) => s.status === "active");

  const parsed = bulk ? parseStaffPaste(bulk.text, registrableStores, { defaultStoreId: bulk.storeId, canAssignLevel: me.level === 4 }) : null;
  const okRows = parsed?.rows.filter((r) => !r.error) ?? [];
  const nameOfStore = (id: string | null) => stores.find((x) => x.id === id)?.name ?? "";

  return (
    <>
      <h1>スタッフ</h1>
      <p className="hint">あなたが見られる人だけが表示されます。</p>

      {issued && (
        <div className="notice">
          <b>{issued.name}</b> さんのパスコード：<span className="pc">{issued.passcode}</span>
          <div className="sub">この画面を閉じると二度と表示されません。本人にだけ伝えてください。</div>
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => setIssued(null)}>閉じる</button>
        </div>
      )}

      {me.level === 4 && (() => {
        const act = staff.filter((x) => x.status === "active");
        const n = (k: string) => act.filter((x) => x.presence === k).length;
        return <p className="hint">オンライン <b>{n("online")}</b> 人 ／ ログイン済み（開いていない） <b>{n("idle")}</b> 人 ／ ログアウト済み <b>{n("loggedout")}</b> 人 ／ まだログインしていない <b>{n("never")}</b> 人（社員番号の小さい順）</p>;
      })()}
      <ul className="list">
        {staff.map((s) => (
          <li key={s.id} className={s.status === "disabled" ? "off" : ""}>
            <div>
              <b>{s.name}</b> <span className="sub">{storeName(s.storeId)}</span>{s.displayOnly && <span className="chip warn">表示専用（お店の端末）</span>}
              <div className="sub">社員番号 {s.employeeCode}{s.status === "disabled" && " ／ 退職（無効）"}{s.status === "active" && !s.displayOnly && (s.onShift ? " ／ シフトに入る" : " ／ シフトに入らない")}</div>
              {s.status === "active" && s.canEvaluate && <div className="sub" style={{ marginTop: 2 }}>✔ 技術評価をつけられる人</div>}
              {s.status === "active" && s.retireOn && <div className="sub" style={{ marginTop: 2, color: "#b45309" }}>退職予定日：{reiwa(s.retireOn)}（この日になると自動で退職になります）</div>}
              {s.status === "active" && <PresenceBadge s={s} />}
            </div>
            <div className="actions">
              {me.level === 4 && (
                <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => {
                  const name = prompt("名前（変えないときはそのまま）", s.name); if (name === null) return;
                  const code = prompt("社員番号（変えないときはそのまま）", s.employeeCode); if (code === null) return;
                  run(() => api(`/api/staff/${s.id}/profile`, { name, employeeCode: code }));
                }}>名前・番号を変える</button>
              )}
              {me.level === 4 && s.status === "active" && !s.displayOnly && (
                <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => run(() => api(`/api/staff/${s.id}/evaluate`, { on: !s.canEvaluate }))}>
                  {s.canEvaluate ? "技術評価をつけられる人：外す" : "技術評価をつけられる人にする"}
                </button>
              )}
              {me.level === 4 && s.status === "active" && (
                <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => {
                  const v = prompt(`${s.name} さんの退職予定日（例 2026-12-31 または 2026/12）。月だけ入れると、その月の月末になります。この日になると自動で退職になります。取り消すときは空にしてください。`, s.retireOn ?? "");
                  if (v === null) return;
                  const t = v.trim().replace(/[年/]/g, "-").replace(/月/g, "-").replace(/日/g, "").replace(/-$/, "");
                  let date: string | null = null;
                  if (t) {
                    const m = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
                    if (!m) { setMsg("「2026-12-31」や「2026/12」の形で入力してください"); return; }
                    const y = Number(m[1]), mo = Number(m[2]), d = m[3] ? Number(m[3]) : new Date(Date.UTC(y, mo, 0)).getUTCDate();
                    date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  }
                  run(() => api(`/api/staff/${s.id}/retire-on`, { date }));
                }}>退職予定日</button>
              )}
              {me.level === 4 && s.status === "disabled" && !s.employeeCode.includes("-退職") && (
                <button className="ghost" style={{ color: "var(--blue)" }}
                  onClick={() => confirm(`${s.name} さんの社員番号「${s.employeeCode}」を空けて、新しい人が使えるようにしますか？（${s.name} さんの番号は「${s.employeeCode}-退職」に変わります。過去の記録はそのまま残ります）`) &&
                    run(() => api(`/api/staff/${s.id}/release`, {}))}>
                  番号を空ける
                </button>
              )}
              {me.level === 4 && s.status === "active" && s.id !== me.id && !s.displayOnly ? (
                <select value={s.level} onChange={(e) => run(() => api(`/api/staff/${s.id}/level`, { level: Number(e.target.value) }))}>
                  {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                </select>
              ) : <span className="chip">{LEVEL_NAMES[s.level]}</span>}
              {s.manageable && s.status === "active" && (
                <>
                  <button className="ghost" style={{ color: "var(--blue)" }}
                    onClick={() => confirm(`${s.name} さんのパスコードを新しくしますか？（今のパスコードは使えなくなります）`) &&
                      run(async () => setIssued({ name: s.name, passcode: (await api<{ passcode: string }>(`/api/staff/${s.id}/passcode`, {})).passcode }))}>
                    パスコード再発行
                  </button>
                  {!s.displayOnly && <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => run(() => api(`/api/staff/${s.id}/onshift`, { onShift: !s.onShift }))}>
                    {s.onShift ? "シフトから外す" : "シフトに入れる"}
                  </button>}
                  <button className="ghost" onClick={() => confirm(`${s.name} さんを退職（無効）にしますか？`) && run(() => api(`/api/staff/${s.id}/disable`, {}))}>
                    退職にする
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h2>スタッフを追加</h2>
      {canRegister && <button className="ghost" style={{ color: "var(--blue)", width: "auto", margin: "8px 0" }} disabled={registrableStores.length === 0} onClick={() => { setBulk({ text: "", storeId: registrableStores[0]?.id ?? me.storeId }); setBulkMsg(""); }}>Excelからまとめて登録</button>}
      {!canRegister ? <p className="hint">スタッフの登録ができるのは、レベル3（店長）以上です。</p> : (
        <form onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await api<{ passcode: string }>("/api/staff", form);
            setIssued({ name: form.name, passcode: r.passcode });
            setForm({ ...form, name: "", employeeCode: "", level: 1, displayOnly: false });
          });
        }}>
          <label htmlFor="nm">名前</label>
          <input id="nm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label htmlFor="cd">社員番号（ログインに使います）</label>
          <input id="cd" inputMode="numeric" value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} required />
          <label htmlFor="st">お店</label>
          <select id="st" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
            {registrableStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {me.level === 4 && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--ink)", margin: "14px 0 0" }}>
              <input type="checkbox" style={{ width: 20, height: 20 }} checked={form.displayOnly} onChange={(e) => setForm({ ...form, displayOnly: e.target.checked, level: 1 })} />
              お店の端末（iPadなど）。見るだけのアカウントにする
            </label>
          )}
          {me.level === 4 && !form.displayOnly && (
            <>
              <label htmlFor="lv">レベル</label>
              <select id="lv" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) as Level })}>
                {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
              </select>
            </>
          )}
          <button type="submit">追加する（パスコードが発行されます）</button>
        </form>
      )}

      {bulk && parsed && (
        <div className="sheet-bg" onClick={() => !bulkBusy && setBulk(null)}>
          <div className="sheet" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="まとめて登録">
            <b style={{ fontSize: 18 }}>Excelからまとめて登録</b>
            <p className="sub">Excelの表をコピーして、下にはりつけてください。列は「名前・社員番号・お店・レベル」の順です（お店・レベルは省けます）。レベルの欄に「表示専用」と書くと、お店のiPadなどの、見るだけのアカウントになります（管理者だけ）。見出しの行があれば、見出しの言葉で読みます。<b>メールアドレスの列は、無視します。</b></p>
            <textarea aria-label="貼り付け" rows={7} style={{ width: "100%", fontSize: 14, padding: 10, borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" }}
              value={bulk.text} onChange={(e) => setBulk({ ...bulk, text: e.target.value })} placeholder={"名前\t社員番号\t（お店）\t（レベル）\n大坪\t1003\n永尾\t1004"} />
            <label>お店が書かれていない行は、このお店にします
              <select value={bulk.storeId} onChange={(e) => setBulk({ ...bulk, storeId: e.target.value })}>{registrableStores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            {parsed.rows.length > 0 && (
              <div className="scroll" style={{ marginTop: 10, maxHeight: 260, overflow: "auto" }}>
                <table className="sttable"><thead><tr><th>名前</th><th>社員番号</th><th>お店</th><th>レベル</th><th>確認</th></tr></thead>
                  <tbody>{parsed.rows.map((r) => (
                    <tr key={r.line} className={r.error ? "empty" : ""}><td>{r.name}</td><td>{r.employeeCode}</td><td>{nameOfStore(r.storeId) || r.storeName}</td><td>{r.displayOnly ? "表示専用" : LEVEL_NAMES[r.level].replace(/^レベル\d /, "")}</td>
                      <td style={{ color: r.error ? "#d70015" : "#1e7e34" }}>{r.error ?? "OK"}</td></tr>))}</tbody></table>
              </div>
            )}
            <p className="sub" style={{ margin: "8px 0" }}>{parsed.rows.length === 0 ? "" : parsed.rows.length === okRows.length ? `${okRows.length}人を登録します。` : `${parsed.rows.length - okRows.length}行に問題があります。直してから、もう一度はりつけてください。`}</p>
            {bulkMsg && <p className="err">{bulkMsg}</p>}
            <button disabled={bulkBusy || parsed.rows.length === 0 || okRows.length !== parsed.rows.length} onClick={async () => {
              if (!confirm(`${okRows.length}人を登録します。登録すると、全員のパスコードが1度だけ表示されます。よろしいですか？`)) return;
              setBulkBusy(true); setBulkMsg("");
              try {
                const r = await api<{ count: number; created: BulkStaffResult[] }>("/api/staff/bulk", { rows: okRows.map((x) => ({ name: x.name, employeeCode: x.employeeCode, storeId: x.storeId, level: x.level, displayOnly: x.displayOnly })) });
                setBulk(null); setBulkDone(r.created); setBulkNote(""); await load();
              } catch (e) { setBulkMsg((e as Error).message); }
              setBulkBusy(false);
            }}>{bulkBusy ? "登録中…" : `${okRows.length}人を登録する`}</button>
            <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} disabled={bulkBusy} onClick={() => setBulk(null)}>キャンセル</button>
          </div>
        </div>
      )}

      {bulkDone && (
        <div className="sheet-bg">
          <div className="sheet printable" style={{ maxWidth: 640 }} role="dialog" aria-label="登録できました">
            <b style={{ fontSize: 18 }}>{bulkDone.length}人を登録しました</b>
            <div className="notice noprint"><b>パスコードは、この画面でしか見られません。</b><div className="sub">閉じる前に、印刷するか、コピーして、本人に伝えてください。閉じると、二度と表示されません（忘れたときは、再発行できます）。</div></div>
            <h1 className="printonly" style={{ fontSize: 16 }}>スタッフのパスコード（会社ID: album）　※本人にだけ渡してください</h1>
            <div className="scroll" style={{ maxHeight: 340, overflow: "auto" }}>
              <table className="sttable"><thead><tr><th>名前</th><th>社員番号</th><th>お店</th><th>パスコード</th></tr></thead>
                <tbody>{bulkDone.map((r) => <tr key={r.employeeCode}><td>{r.name}{r.displayOnly ? "（表示専用）" : ""}</td><td>{r.employeeCode}</td><td>{nameOfStore(r.storeId)}</td><td><b style={{ letterSpacing: 2, fontSize: 16 }}>{r.passcode}</b></td></tr>)}</tbody></table>
            </div>
            <div className="actions noprint" style={{ margin: "10px 0" }}>
              <button className="ghost" style={{ color: "var(--ink)" }} onClick={() => { document.body.classList.add("printing-result"); window.print(); document.body.classList.remove("printing-result"); }}>印刷</button>
              <button className="ghost" style={{ color: "var(--ink)" }} onClick={async () => setBulkNote((await copyText(["名前\t社員番号\tお店\tパスコード", ...bulkDone.map((r) => [r.name, r.employeeCode, nameOfStore(r.storeId), r.passcode].join("\t"))].join("\n"))) ? "表をコピーしました" : "コピーできませんでした")}>表をコピー</button>
              {bulkNote && <span className="sub">{bulkNote}</span>}
            </div>
            <button className="noprint" onClick={() => confirm("パスコードは、もう表示できません。控えましたか？") && setBulkDone(null)}>控えました。閉じる</button>
          </div>
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
