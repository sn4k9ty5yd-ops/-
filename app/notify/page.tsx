"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push-client";
import type { NoticeSetting } from "@/lib/service";
import Guide from "./Guide";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function Page() {
  const { me } = useMe();
  const [st, setSt] = useState<PushState | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"ios" | "android">("ios");
  const [notice, setNotice] = useState<NoticeSetting[]>([]);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => setSt(await pushState()), []);
  useEffect(() => { refresh(); if (/Android/i.test(navigator.userAgent)) setKind("android"); }, [refresh]);
  const loadNotice = useCallback(() => api<NoticeSetting[]>("/api/notice-settings").then(setNotice).catch(() => {}), []);
  useEffect(() => { if (me.level >= 3) loadNotice(); }, [me.level, loadNotice]);

  const on = async () => { setBusy(true); setMsg(""); try { setSt(await enablePush()); } catch (e) { setMsg((e as Error).message || "通知をオンにできませんでした"); } setBusy(false); };
  const off = async () => { setBusy(true); try { await disablePush(); } catch { /* ignore */ } await refresh(); setBusy(false); };
  const test = async () => { setBusy(true); setMsg(""); try { const r = await api<{ sent: number }>("/api/push/test", {}); setMsg(r.sent > 0 ? "テスト通知を送りました。数秒で届きます。" : "送れませんでした。もう一度「通知をオンにする」を押してください。"); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  const save = async (s: NoticeSetting, patch: Partial<NoticeSetting>) => {
    const n = { ...s, ...patch };
    try { await api("/api/notice-settings", { storeId: n.storeId, enabled: n.enabled, time: n.time }); setNote("保存しました"); await loadNotice(); } catch (e) { setNote((e as Error).message); }
  };

  const label: Record<PushState, string> = {
    on: "✅ 通知は、オンです。", off: "通知は、まだオフです。", denied: "通知が「許可しない」になっています。", unsupported: "この端末（ブラウザ）では、通知を使えません。",
    "needs-install": "iPhoneでは、先に「ホーム画面に追加」が必要です。下の案内のとおりに進めてください。",
  };

  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>スマホに通知を届ける</h1>
      <p className="sub">シフトが公開されたときや、毎朝の「今日の出勤メンバー」などが、スマホに届きます。アプリを開かなくても、画面に出ます。</p>

      <div className="card">
        <b>いまの状態</b>
        <p style={{ margin: "6px 0 10px" }}>{st ? label[st] : "確認中…"}</p>
        {st === "denied" && <p className="hint">スマホの「設定」→「ALBUM（またはブラウザ）」→「通知」を「許可」にしてから、もう一度ためしてください。</p>}
        <div className="toolbar">
          {(st === "off" || st === "denied") && <button onClick={on} disabled={busy}>通知をオンにする</button>}
          {st === "on" && <><button onClick={test} disabled={busy}>テスト通知を送る</button><button className="ghost" onClick={off} disabled={busy}>通知をオフにする</button></>}
        </div>
        {msg && <p className="sub">{msg}</p>}
      </div>

      <h2>やり方（絵つき）</h2>
      <div className="seg" style={{ maxWidth: 360 }}>
        <button className={kind === "ios" ? "on" : ""} onClick={() => setKind("ios")}>iPhone</button>
        <button className={kind === "android" ? "on" : ""} onClick={() => setKind("android")}>Android</button>
      </div>
      <Guide kind={kind} />
      <p className="hint">「ホーム画面に追加」は、1台につき1回だけです。通知がこない場合は、機内モードや「おやすみモード」をオフにしてください。</p>

      {me.level >= 3 && (
        <>
          <h2>毎朝の「今日のメンバー」通知（お店の設定）</h2>
          <p className="sub">決めた時刻に、そのお店の全員へ「今日の出勤メンバー・休みメンバー」が届きます。シフトが公開されている日だけ送ります。時刻は5分きざみで、いつでも変えられます。</p>
          {notice.map((s) => (
            <div key={s.storeId} className="card toolbar" style={{ justifyContent: "space-between" }}>
              <b>{s.name}</b>
              <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 14 }}>
                <input type="checkbox" style={{ width: 20 }} checked={s.enabled} disabled={!s.editable} onChange={(e) => save(s, { enabled: e.target.checked })} />使う
              </label>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select aria-label="時" style={{ width: 80 }} disabled={!s.editable || !s.enabled} value={s.time.slice(0, 2)} onChange={(e) => save(s, { time: `${e.target.value}:${s.time.slice(3)}` })}>{HOURS.map((h) => <option key={h} value={h}>{h}</option>)}</select>:
                <select aria-label="分" style={{ width: 80 }} disabled={!s.editable || !s.enabled} value={s.time.slice(3)} onChange={(e) => save(s, { time: `${s.time.slice(0, 2)}:${e.target.value}` })}>{MINS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </span>
              {!s.editable && <span className="sub">（見るだけ）</span>}
            </div>
          ))}
          {note && <p className="sub">{note}</p>}
          <p className="hint">送る時刻になってから、数分〜十数分おくれることがあります（無料の仕組みのため）。</p>
        </>
      )}
    </main>
  );
}
export default function NotifyPage() { return <MeProvider><Page /></MeProvider>; }
