"use client";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { LEVEL_NAMES, type Level } from "@/lib/permissions";

export default function StaffPage() {
  const { staff, stores, me, can, canManage, addStaff, disableStaff, setLevel } = useApp();
  const [form, setForm] = useState({ name: "", email: "", storeId: me.storeId, level: 1 as Level });
  const [msg, setMsg] = useState("");
  const run = (fn: () => void) => { try { fn(); setMsg(""); } catch (e) { setMsg((e as Error).message); } };
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const registrable = stores.filter((s) => can("staff.manage", s.id));
  const canAssign = can("level.assign", me.storeId);

  return (
    <>
      <h1>スタッフ</h1>
      <p className="hint">あなたが見られる人だけが表示されます。</p>
      <ul className="list">
        {staff.map((s) => (
          <li key={s.id} className={s.status === "disabled" ? "off" : ""}>
            <div>
              <b>{s.name}</b> <span className="sub">{storeName(s.storeId)}</span>
              <div className="sub">{s.email} ／ 有給 残り{s.paidLeaveLeft}日{s.status === "disabled" && " ／ 退職（無効）"}</div>
            </div>
            <div className="actions">
              {can("level.assign", s.storeId) && s.status === "active" ? (
                <select value={s.level} onChange={(e) => run(() => setLevel(s.id, Number(e.target.value) as Level))}>
                  {([1, 2, 3, 4] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                </select>
              ) : (
                <span className="chip">{LEVEL_NAMES[s.level]}</span>
              )}
              {canManage(s) && s.status === "active" && (
                <button className="ghost" onClick={() => confirm(`${s.name} を退職（無効）にしますか？`) && run(() => disableStaff(s.id))}>
                  退職にする
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h2>スタッフを追加</h2>
      {registrable.length === 0 ? (
        <p className="hint">スタッフの登録ができるのは、レベル3（店長）以上です。</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(() => { addStaff(form); setForm({ ...form, name: "", email: "", level: 1 }); }); }}>
          <label htmlFor="nm">名前</label>
          <input id="nm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label htmlFor="em">メールアドレス</label>
          <input id="em" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label htmlFor="st">お店</label>
          <select id="st" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
            {registrable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {canAssign && (
            <>
              <label htmlFor="lv">レベル</label>
              <select id="lv" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) as Level })}>
                {([1, 2, 3, 4] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
              </select>
            </>
          )}
          <button type="submit">追加する</button>
        </form>
      )}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
