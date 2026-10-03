"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Done = { companyCode: string; employeeCode: string; passcode: string; stores: string[] };

export default function SetupPage() {
  const [state, setState] = useState<"loading" | "needed" | "done" | "unconfigured">("loading");
  const [f, setF] = useState({ key: "", companyCode: "album", companyName: "株式会社ALBUM", officeName: "管理者", officeCode: "9000" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Done | null>(null);
  useEffect(() => { api<{ needed: boolean; configured: boolean }>("/api/setup").then((r) => setState(r.needed ? "needed" : r.configured ? "done" : "unconfigured")).catch(() => setState("done")); }, []);
  if (state === "loading") return null;
  if (result) return (
    <main>
      <h1>初期設定ができました</h1>
      <div className="notice">管理者のパスコード：<span className="pc">{result.passcode}</span>
        <div className="sub">この画面を閉じると、二度と表示されません。いま、控えてください。</div></div>
      <div className="card"><div className="sub">ログインに使うもの</div>
        <div>会社ID：<b>{result.companyCode}</b></div><div>社員番号：<b>{result.employeeCode}</b></div><div>パスコード：<b>{result.passcode}</b></div></div>
      <div className="card"><div className="sub">最初に登録したお店</div><div>{result.stores.join("／")}</div>
        <div className="sub">お店の追加や名前の変更は、ログイン後の「⚙ 店舗の編集」でできます。</div></div>
      <Link href="/login" className="card-link"><b>ログイン画面へ</b></Link>
    </main>
  );
  if (state === "done") return <main><h1>初期設定は終わっています</h1><p className="hint">この画面は、最初の1回だけ使えます。<Link href="/login">ログイン画面へ</Link></p></main>;
  if (state === "unconfigured") return <main><h1>初期設定の準備ができていません</h1><p className="hint">サーバーの設定に「SETUP_KEY」（16文字以上の合言葉）が必要です。</p></main>;
  return (
    <main>
      <p className="sub" style={{ marginBottom: 4 }}>最初の1回だけ</p>
      <h1>初期設定</h1>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr("");
        try { setResult(await api<Done>("/api/setup", f)); } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <label htmlFor="key">合言葉（サーバーに設定した SETUP_KEY）</label>
        <input id="key" type="password" autoComplete="off" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} required />
        <label htmlFor="cc">会社ID（ログインで使います。英小文字・数字）</label>
        <input id="cc" autoCapitalize="none" value={f.companyCode} onChange={(e) => setF({ ...f, companyCode: e.target.value })} required />
        <label htmlFor="cn">会社名</label>
        <input id="cn" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} required />
        <label htmlFor="on">管理者の名前</label>
        <input id="on" value={f.officeName} onChange={(e) => setF({ ...f, officeName: e.target.value })} required />
        <label htmlFor="oc">管理者の社員番号（英数字）</label>
        <input id="oc" value={f.officeCode} onChange={(e) => setF({ ...f, officeCode: e.target.value })} required />
        <p className="hint">お店は、ATENA／ATENA六本松／ATENA福津／Organ／ATENA AVEDA SAKURAMACHI の5つが、最初に作られます。</p>
        <button type="submit" disabled={busy}>{busy ? "作成中…" : "初期設定をする"}</button>
      </form>
      {err && <p className="err">{err}</p>}
    </main>
  );
}
