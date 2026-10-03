"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [f, setF] = useState({ company: "", code: "", passcode: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="aurora" aria-hidden />
      <p className="eyebrow">株式会社</p>
      <h1 className="hero wordmark">ALBUM</h1>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr("");
        try { await api("/api/login", f); router.replace("/home"); }
        catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <label htmlFor="company">会社ID</label>
        <input id="company" autoCapitalize="none" autoComplete="organization" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} required />
        <label htmlFor="code">社員番号</label>
        <input id="code" inputMode="numeric" autoComplete="username" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
        <label htmlFor="passcode">パスコード（6けた）</label>
        <input id="passcode" type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={f.passcode} onChange={(e) => setF({ ...f, passcode: e.target.value })} required />
        <button type="submit" disabled={busy}>{busy ? "確認中…" : "ログイン"}</button>
      </form>
      {err && <p className="err">{err}</p>}
      <p className="hint">パスコードを忘れたときは、オフィスに連絡してください。</p>
    </main>
  );
}
