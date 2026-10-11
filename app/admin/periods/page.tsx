"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { NEXT_ACTION } from "@/lib/labels";
import { reiwaRange } from "@/lib/era";
import { PeriodNav, periodFor, todayJst } from "@/lib/period-nav";
import type { Period } from "@/lib/periods";
import { relationLabel } from "@/lib/periods";
import { LimitRequired } from "@/app/admin/shifts/LimitAll";
import { OffProgress } from "./OffProgress";
import { daysOf } from "@/lib/labels";
import { STEP_GUIDE } from "@/lib/step-guide";
import { STATUS_LABEL, STATUS_ORDER, type PeriodRow, type PeriodStatus } from "@/lib/service";

export default function PeriodsPage() {
  const { me } = useMe();
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; status: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api<PeriodRow[]>("/api/periods"), api<{ id: string; name: string; status: string }[]>("/api/stores")]);
    setPeriods(p); setStores(s);
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); } };
  const name = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const canManage = (storeId: string) => me.level === 4 || (me.level >= 2 && storeId === me.storeId);

  const advance = (periodId: string, storeId: string, next: { to: PeriodStatus; label: string }) =>
    confirm(`${name(storeId)}：「${next.label}」でよいですか？`) && run(async () => {
      try { await api("/api/periods", { periodId, storeId, status: next.to }); }
      catch (e) {
        if (!(e as Error).message.includes("かぶっている")) throw e;
        if (confirm(`${(e as Error).message}\n\nそれでも、このまま確定しますか？`)) await api("/api/periods", { periodId, storeId, status: next.to, force: true });
      }
    });
  // 見る期間は、矢印で前後に動かせる。はじめは「いま進めるシフト」（自分のお店の、確認済みになっていない、いちばん近い期間）
  const todayStr = todayJst();
  const todoPeriod = [...periods].sort((x, y) => x.start.localeCompare(y.start)).filter((x) => x.end >= todayStr).find((x) => { const s = x.stores.find((y) => y.storeId === me.storeId); return s && s.status !== "acknowledged"; });
  const [sel, setSel] = useState<Period | null>(null);
  const [storeId, setStoreId] = useState(me.storeId);
  useEffect(() => {
    if (sel || periods.length === 0) return;
    setSel(todoPeriod ? { start: todoPeriod.start, end: todoPeriod.end, label: todoPeriod.label } : periodFor(todayStr, me.closingStartDay));
  }, [periods]); // eslint-disable-line react-hooks/exhaustive-deps
  const dbP = periods.find((x) => x.start === sel?.start);
  const st = dbP?.stores.find((x) => x.storeId === storeId);
  const shownStores = (me.level === 4 ? stores.filter((x) => x.status !== "closed") : stores.filter((x) => x.id === me.storeId));
  return (
    <>
      <h1>つくる</h1>
      <p className="hint">シフトを作って、正美さんに出すまでの「やること」です。上の矢印（‹ ›）で、前のシフト・次のシフトに動かせます。</p>
      {me.level === 4 && shownStores.length > 1 && (
        <select aria-label="お店" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 8 }}>{shownStores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      )}
      {sel && <PeriodNav period={sel} startDay={me.closingStartDay} onChange={setSel} />}
      {sel && !dbP && (
        <div className="card" style={{ margin: "10px 0" }}>
          <b>この期間は、まだ作られていません。</b>
          <p className="sub" style={{ margin: "4px 0" }}>下の「次の期間を作る」を押すと、いまあるいちばん先の期間の、次のシフトができます。（前の期間から順に作ります）</p>
        </div>
      )}
      {sel && dbP && !st && <p className="hint">この期間に、{name(storeId)}のシフトはありません。</p>}
      {sel && dbP && st && (() => {
        const next = NEXT_ACTION[st.status];
        const idx = STATUS_ORDER.indexOf(st.status);
        const cur = STEP_GUIDE[idx];
        const can = next && canManage(storeId) && (next.to !== "acknowledged" || me.level >= 3);
        return (
          <>
            <div className="card guide" style={{ margin: "10px 0" }}>
              <span className="sub">{name(storeId)}　{reiwaRange(dbP.start, dbP.end)}</span>
              <ol className="stepguide">
                {STEP_GUIDE.filter((g) => g.key !== "closed" || st.status === "closed").map((g) => { const i = STATUS_ORDER.indexOf(g.key); return (
                  <li key={g.key} className={i < idx ? "done" : i === idx ? "now" : ""}>
                    <span className="sgdot">{i < idx ? "✓" : i === idx ? "●" : ""}</span>
                    <div>
                      <b>{g.short}</b>
                      {i === idx && <p className="whatnow">{cur.now}</p>}
                    </div>
                  </li>
                ); })}
              </ol>
              {st.status === "preparing" && canManage(storeId) && <LimitRequired periodId={dbP.id} storeId={storeId} days={daysOf(dbP.start, dbP.end)} />}
              {can && <button onClick={() => { advance(dbP.id, storeId, next); }}>次は：{next.label}</button>}
              {!can && next && <p className="hint" style={{ margin: "6px 0 0" }}>この次の操作は、{cur.who || "店長・正美さん"}が行います。</p>}
              {cur.open && <Link href="/admin/shifts" className="ghost" style={{ display: "block", textAlign: "center", padding: 10 }}>出勤簿予定を開く</Link>}
              {canManage(storeId) && (st.status === "preparing" || st.status === "collecting") && (
                <label className="sub" style={{ margin: "10px 0 0", display: "block" }}>希望休の締切（いつまでに出してもらうか）
                  <input type="datetime-local" key={st.closeAt ?? "none"} defaultValue={st.closeAt ? st.closeAt.slice(0, 16).replace(" ", "T") : ""} style={{ fontSize: 14, padding: 8 }}
                    onBlur={(e) => e.target.value && run(() => api("/api/periods", { periodId: dbP.id, storeId, closeAt: `${e.target.value}:00+09:00` }))} />
                </label>
              )}
              {canManage(storeId) && st.status !== "preparing" && (
                <button className="ghost" style={{ color: "var(--sub)", marginTop: 8 }}
                  onClick={() => confirm("ひとつ前の状態に戻しますか？") && run(() => api("/api/periods", { periodId: dbP.id, storeId, status: STATUS_ORDER[STATUS_ORDER.indexOf(st.status as PeriodStatus) - 1] }))}>
                  ひとつ戻す
                </button>
              )}
            </div>
            {me.level >= 2 && ["preparing", "collecting", "closed", "drafting"].includes(st.status) && <OffProgress periodId={dbP.id} storeId={storeId} start={dbP.start} end={dbP.end} canEdit={canManage(storeId)} />}
          </>
        );
      })()}
      {me.level >= 2 && <button onClick={() => run(async () => { const r = await api<{ created: boolean; label: string; start?: string }>("/api/periods", { action: "next" }); setNote(r.created ? `「${r.label}」を作りました` : `「${r.label}」は、すでにあります`); })}>＋ 次の期間を作る</button>}
      {periods.length === 0 && <p className="hint">まだ期間がありません。「次の期間を作る」を押してください。</p>}
      {note && <p className="hint">{note}</p>}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
