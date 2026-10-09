"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { NEXT_ACTION } from "@/lib/labels";
import { reiwaRange } from "@/lib/era";
import { periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import { relationLabel } from "@/lib/periods";
import { LimitRequired } from "@/app/admin/shifts/LimitAll";
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
  // 「やること」: 自分のお店の、いま進めるシフト（確認済みになるまで）
  const todayStr = todayJst();
  const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
  const todo = [...periods].sort((x, y) => x.start.localeCompare(y.start)).filter((x) => x.end >= todayStr).map((x) => ({ p: x, s: x.stores.find((y) => y.storeId === me.storeId) })).find((x) => x.s && x.s.status !== "acknowledged");
  return (
    <>
      
      <h1>つくる</h1>
      <p className="hint">シフトを作って、事務員さんに出すまでの「やること」です。いまの段階と、次に押すボタンが出ます。</p>
      {todo && todo.s && (() => {
        const { p, s } = todo; const next = NEXT_ACTION[s.status];
        const idx = STATUS_ORDER.indexOf(s.status);
        const cur = STEP_GUIDE[idx];
        const can = next && canManage(s.storeId) && (next.to !== "acknowledged" || me.level >= 3);
        return (
          <div className="card guide" style={{ margin: "10px 0" }}>
            <span className="sub">いま進めるシフト（{name(s.storeId)}）</span>
            <div style={{ marginBottom: 8 }}><b style={{ fontSize: 20 }}>{p.label}</b>　<span className="sub">{reiwaRange(p.start, p.end)}</span></div>
            <ol className="stepguide">
              {STEP_GUIDE.filter((g) => g.key !== "closed" || s.status === "closed").map((g) => { const i = STATUS_ORDER.indexOf(g.key); return (
                <li key={g.key} className={i < idx ? "done" : i === idx ? "now" : ""}>
                  <span className="sgdot">{i < idx ? "✓" : i === idx ? "●" : ""}</span>
                  <div>
                    <b>{g.short}</b>
                    {i === idx && <p className="whatnow">{cur.now}</p>}
                  </div>
                </li>
              ); })}
            </ol>
            {s.status === "preparing" && canManage(s.storeId) && <LimitRequired periodId={p.id} storeId={s.storeId} days={daysOf(p.start, p.end)} />}
            {can && <button onClick={() => { advance(p.id, s.storeId, next); }}>次は：{next.label}</button>}
            {!can && next && <p className="hint" style={{ margin: "6px 0 0" }}>この次の操作は、{cur.who || "店長・事務員さん"}が行います。</p>}
            {cur.open && <Link href="/admin/shifts" className="ghost" style={{ display: "block", textAlign: "center", padding: 10 }}>出勤簿予定を開く</Link>}
          </div>
        );
      })()}
      {!todo && periods.length > 0 && <p className="hint">いま進めるシフトは、ありません。下の「次の期間を作る」を押すと、次のシフトを始められます。</p>}
      {me.level >= 2 && <button onClick={() => run(async () => { const r = await api<{ created: boolean; label: string }>("/api/periods", { action: "next" }); setNote(r.created ? `「${r.label}」を作りました` : `「${r.label}」は、もう作ってあります`); })}>次の期間を作る</button>}
      {periods.length === 0 && <p className="hint">まだ期間がありません。「次の期間を作る」を押してください。</p>}
      {periods.slice(0, 3).map((p) => {
        const rel = relationLabel(p.start, periodFor(todayJst(), me.closingStartDay).start);
        return (
        <div key={p.id} className="card tint" style={{ marginTop: 16, ...tintStyle(p.start) }}>
          <span className={`badge2 ${rel.kind}`}>{rel.label}</span> <b style={{ fontSize: 18 }}>{p.label}</b> <span className="sub">{reiwaRange(p.start, p.end)}</span>
          {p.stores.filter((s) => (me.level === 4 || s.storeId === me.storeId) && stores.find((x) => x.id === s.storeId)?.status !== "closed").map((s) => {
            const next = NEXT_ACTION[s.status];
            const needOffice = next?.to === "acknowledged";
            return (
              <div key={s.storeId} className="storerow">
                <div><b>{name(s.storeId)}</b><div className="sub">{STATUS_LABEL[s.status]}</div>
                  <div className="steps2">{STATUS_ORDER.map((x) => <i key={x} className={x === s.status ? "now" : STATUS_ORDER.indexOf(x) < STATUS_ORDER.indexOf(s.status) ? "done" : ""} />)}</div>
                </div>
                <div className="actions">
                  {canManage(s.storeId) && (s.status === "preparing" || s.status === "collecting") && (
                    <label className="sub" style={{ margin: 0 }}>希望休の締切（いつまでに出してもらうか）
                      <input type="datetime-local" key={s.closeAt ?? "none"} defaultValue={s.closeAt ? s.closeAt.slice(0, 16).replace(" ", "T") : ""} style={{ fontSize: 14, padding: 8 }}
                        onBlur={(e) => e.target.value && run(() => api("/api/periods", { periodId: p.id, storeId: s.storeId, closeAt: `${e.target.value}:00+09:00` }))} />
                    </label>
                  )}
                  {next && canManage(s.storeId) && (!needOffice || me.level >= 3) && (
                    <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }}
                      onClick={() => advance(p.id, s.storeId, next)}>
                      {next.label}
                    </button>
                  )}
                  {canManage(s.storeId) && s.status !== "preparing" && (me.level >= 3 || s.status !== "acknowledged") && (
                    <button className="ghost" style={{ color: "var(--sub)" }}
                      onClick={() => confirm("ひとつ前の状態に戻しますか？") && run(() => api("/api/periods", { periodId: p.id, storeId: s.storeId, status: STATUS_ORDER[STATUS_ORDER.indexOf(s.status as PeriodStatus) - 1] }))}>
                      ひとつ戻す
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        );
      })}
      {note && <p className="hint">{note}</p>}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
