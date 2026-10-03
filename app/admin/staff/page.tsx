"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";
import { LEVEL_NAMES, type Level } from "@/lib/permissions";
import type { StaffRow } from "@/lib/service";

type Store = { id: string; name: string };
const LEVELS: Level[] = [1, 2, 3, 4];

export default function StaffPage() {
  const { me } = useMe();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [form, setForm] = useState({ name: "", employeeCode: "", storeId: me.storeId, level: 1 as Level });
  const [msg, setMsg] = useState("");
  const [issued, setIssued] = useState<{ name: string; passcode: string } | null>(null);

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([api<StaffRow[]>("/api/staff"), api<Store[]>("/api/stores")]);
    setStaff(s); setStores(st);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const canRegister = me.level >= 3;
  const registrableStores = me.level === 4 ? stores : stores.filter((s) => s.id === me.storeId);

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

      <ul className="list">
        {staff.map((s) => (
          <li key={s.id} className={s.status === "disabled" ? "off" : ""}>
            <div>
              <b>{s.name}</b> <span className="sub">{storeName(s.storeId)}</span>
              <div className="sub">社員番号 {s.employeeCode}{s.status === "disabled" && " ／ 退職（無効）"}</div>
            </div>
            <div className="actions">
              {me.level === 4 && s.status === "active" && s.id !== me.id ? (
                <select value={s.level} onChange={(e) => run(() => api(`/api/staff/${s.id}/level`, { level: Number(e.target.value) }))}>
                  {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                </select>
              ) : <span className="chip">{LEVEL_NAMES[s.level]}</span>}
              {s.manageable && s.status === "active" && s.id !== me.id && (
                <>
                  <button className="ghost" style={{ color: "var(--blue)" }}
                    onClick={() => confirm(`${s.name} さんのパスコードを新しくしますか？（今のパスコードは使えなくなります）`) &&
                      run(async () => setIssued({ name: s.name, passcode: (await api<{ passcode: string }>(`/api/staff/${s.id}/passcode`, {})).passcode }))}>
                    パスコード再発行
                  </button>
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
      {!canRegister ? <p className="hint">スタッフの登録ができるのは、レベル3（店長）以上です。</p> : (
        <form onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await api<{ passcode: string }>("/api/staff", form);
            setIssued({ name: form.name, passcode: r.passcode });
            setForm({ ...form, name: "", employeeCode: "", level: 1 });
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
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
