"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { NEXT_ACTION } from "@/lib/labels";
import { reiwaRange } from "@/lib/era";
import { periodFor, todayJst, tintStyle } from "@/lib/period-nav";
import { relationLabel } from "@/lib/periods";
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

  return (
    <>
      <h1>シフト期間</h1>
      {me.level >= 2 && <button onClick={() => run(async () => { const r = await api<{ created: boolean; label: string }>("/api/periods", { action: "next" }); setNote(r.created ? `「${r.label}」を作りました` : `「${r.label}」は、もう作ってあります`); })}>次の期間を作る</button>}
      {periods.length === 0 && <p className="hint">まだ期間がありません。「次の期間を作る」を押してください。</p>}
      {periods.map((p) => {
        const rel = relationLabel(p.start, periodFor(todayJst(), me.closingStartDay).start);
        return (
        <div key={p.id} className="card tint" style={{ marginTop: 16, ...tintStyle(p.start) }}>
          <span className={`badge2 ${rel.kind}`}>{rel.label}</span> <b style={{ fontSize: 18 }}>{p.label}</b> <span className="sub">{reiwaRange(p.start, p.end)}</span>
          {p.stores.filter((s) => stores.find((x) => x.id === s.storeId)?.status !== "closed").map((s) => {
            const next = NEXT_ACTION[s.status];
            const needOffice = next?.to === "acknowledged";
            return (
              <div key={s.storeId} className="storerow">
                <div><b>{name(s.storeId)}</b><div className="sub">{STATUS_LABEL[s.status]}</div>
                  <div className="steps2">{STATUS_ORDER.map((x) => <i key={x} className={x === s.status ? "now" : STATUS_ORDER.indexOf(x) < STATUS_ORDER.indexOf(s.status) ? "done" : ""} />)}</div>
                </div>
                <div className="actions">
                  {canManage(s.storeId) && s.status === "preparing" && (
                    <label className="sub" style={{ margin: 0 }}>締切
                      <input type="datetime-local" defaultValue={s.closeAt ? s.closeAt.slice(0, 16).replace(" ", "T") : ""} style={{ fontSize: 14, padding: 8 }}
                        onBlur={(e) => e.target.value && run(() => api("/api/periods", { periodId: p.id, storeId: s.storeId, closeAt: `${e.target.value}:00+09:00` }))} />
                    </label>
                  )}
                  {next && canManage(s.storeId) && (!needOffice || me.level === 4) && (
                    <button style={{ width: "auto", margin: 0, padding: "10px 14px", fontSize: 14 }}
                      onClick={() => confirm(`${name(s.storeId)}：「${next.label}」でよいですか？`) && run(async () => {
                        try { await api("/api/periods", { periodId: p.id, storeId: s.storeId, status: next.to }); }
                        catch (e) {
                          if (!(e as Error).message.includes("かぶっている")) throw e;
                          if (confirm(`${(e as Error).message}\n\nそれでも、このまま確定しますか？`)) await api("/api/periods", { periodId: p.id, storeId: s.storeId, status: next.to, force: true });
                        }
                      })}>
                      {next.label}
                    </button>
                  )}
                  {me.level === 4 && s.status !== "preparing" && (
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
