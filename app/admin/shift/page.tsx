"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, useAutoRefresh, useMe } from "@/lib/client";
import { NEXT_ACTION } from "@/lib/labels";
import { reiwaRange } from "@/lib/era";
import { periodFor, todayJst } from "@/lib/period-nav";
import { relationLabel } from "@/lib/periods";
import { STATUS_LABEL, STATUS_ORDER, type PeriodRow } from "@/lib/service";

const TILES = [
  { href: "/admin/requests", t: "① みんなの希望休", s: "スタッフの休みを見る・上限を決める", min: 2 },
  { href: "/admin/shifts", t: "② 出勤簿", s: "日ごと・人ごと・一覧表で、入店・退店を入力", min: 2 },
  { href: "/admin/attendance", t: "③ 勤務時間の提出", s: "働いた時間（休憩・実働）を、事務員さんに提出", min: 2 },
  { href: "/shifts", t: "シフトを見る", s: "今日の出勤・月のシフト", min: 1 },
  { href: "/requests", t: "自分の希望休を出す", s: "休みたい日をえらぶ", min: 1 },
  { href: "/admin/periods", t: "シフト期間（くわしく）", s: "次の期間を作る・締切の日時・進める", min: 2 },
];

export default function ShiftHub() {
  const { me } = useMe();
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; status: string }[]>([]);
  const [storeId, setStoreId] = useState(me.storeId);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api<PeriodRow[]>("/api/periods"), api<{ id: string; name: string; status: string }[]>("/api/stores")]);
    setPeriods(p); setStores(s.filter((x) => x.status === "active"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg(""); await load(); } catch (e) { setMsg((e as Error).message); } };
  const canManage = me.level === 4 || storeId === me.storeId;
  const curStart = periodFor(todayJst(), me.closingStartDay).start;
  const list = [...periods].sort((a, b) => a.start.localeCompare(b.start)).filter((p) => p.end >= curStart).slice(0, 2);
  const hasNext = periods.some((p) => p.start > curStart);

  return (
    <>
      <h1>シフトまとめ</h1>
      <p className="hint">シフトの流れは、上から順に「①希望休を受け付ける → ②出勤簿をつける（入店・退店） → ③確定して公開 → ④勤務時間を提出」です。いまどこまで進んだか、次に何を押すかを、ここで見られます。</p>
      {me.level >= 3 && stores.length > 1 && (
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ marginBottom: 8 }}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {!hasNext && (
        <div className="card" style={{ marginTop: 8 }}>
          <b>次のシフトがまだありません</b>
          <p className="sub">下のボタンを押すと、次の期間（例：16日〜翌月15日）のシフトが作れる状態になります。</p>
          <button onClick={() => run(async () => { const r = await api<{ created: boolean; label: string }>("/api/periods", { action: "next" }); setOk(r.created ? `「${r.label}」のシフトを作りました` : `「${r.label}」はもうあります`); })}>＋ 次のシフトを作る</button>
        </div>
      )}
      {ok && <p className="hint">{ok}</p>}
      {list.map((p) => {
        const s = p.stores.find((x) => x.storeId === storeId);
        const rel = relationLabel(p.start, curStart);
        const next = s ? NEXT_ACTION[s.status] : undefined;
        const blocked = next?.to === "acknowledged";
        return (
          <div key={p.id} className="card" style={{ marginTop: 12 }}>
            <span className={`badge2 ${rel.kind}`}>{rel.label}</span> <b style={{ fontSize: 18 }}>{p.label}</b> <span className="sub">{reiwaRange(p.start, p.end)}</span>
            {!s ? <p className="sub">このお店は、この期間にまだ入っていません。</p> : (
              <>
                <div className="steps2" style={{ margin: "10px 0" }}>{STATUS_ORDER.map((x) => <i key={x} className={x === s.status ? "now" : STATUS_ORDER.indexOf(x) < STATUS_ORDER.indexOf(s.status) ? "done" : ""} />)}</div>
                <p style={{ margin: "4px 0" }}>いま：<b>{STATUS_LABEL[s.status]}</b>　　勤務時間：<b>{{ open: "入力中", submitted: "提出済み", acknowledged: "確認済み" }[s.attendanceStatus]}</b></p>
                {next && canManage && !blocked && (
                  <button onClick={() => confirm(`「${next.label}」でよいですか？`) && run(async () => {
                    try { await api("/api/periods", { periodId: p.id, storeId, status: next.to }); }
                    catch (e) {
                      if (!(e as Error).message.includes("かぶっている")) throw e;
                      if (confirm(`${(e as Error).message}\n\nそれでも、このまま確定しますか？`)) await api("/api/periods", { periodId: p.id, storeId, status: next.to, force: true });
                    }
                  })}>次は：{next.label}</button>
                )}
                {next && blocked && <p className="sub">次は「{next.label}」です（オフィスが行います）。</p>}
                {!canManage && <p className="sub">他のお店です（見るだけ）。</p>}
              </>
            )}
          </div>
        );
      })}
      <h2 style={{ marginTop: 20 }}>よく使う画面</h2>
      <div className="homegrid">
        {TILES.filter((t) => me.level >= t.min).map((t) => (
          <Link key={t.href} href={t.href} className="tile"><b>{t.t}</b><span className="sub">{t.s}</span></Link>
        ))}
      </div>
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
