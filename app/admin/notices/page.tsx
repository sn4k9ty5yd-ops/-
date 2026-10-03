"use client";
import { useState } from "react";
import { ANNOUNCEMENTS } from "@/lib/announcements";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

export default function NoticesPage() {
  const url = typeof window === "undefined" ? "" : window.location.origin;
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(ANNOUNCEMENTS.map((a) => [a.id, a.body(url)])));
  const [done, setDone] = useState("");

  const copy = async (id: string, text: string) => { setDone((await copyText(text)) ? id : ""); setTimeout(() => setDone(""), 2500); };
  const joined = ANNOUNCEMENTS.map((a) => `■■ ${a.title}（${a.to}）■■\n\n${texts[a.id]}`).join("\n\n\n");

  return (
    <>
      <h1>お知らせ文章</h1>
      <p className="hint noprint">LINEやメールに貼るための文章です。【　】の部分や日にちは、下の枠の中で直せます。「コピー」を押して、LINEに貼り付けてください。</p>
      <div className="actions noprint" style={{ marginBottom: 12 }}>
        <button style={{ width: "auto" }} onClick={() => copy("all", joined)}>{done === "all" ? "✓ 全部コピーしました" : "全部まとめてコピー"}</button>
        <button className="ghost" style={{ color: "var(--ink)", width: "auto" }} onClick={() => window.print()}>印刷（書面にする）</button>
        <button className="ghost" style={{ color: "var(--sub)", width: "auto" }} onClick={() => setTexts(Object.fromEntries(ANNOUNCEMENTS.map((a) => [a.id, a.body(url)])))}>全部もとにもどす</button>
      </div>
      {ANNOUNCEMENTS.map((a) => (
        <section key={a.id} className="card" style={{ marginBottom: 16 }}>
          <b style={{ fontSize: 17 }}>{a.title}</b> <span className="sub">送り先：{a.to}</span>
          <textarea value={texts[a.id]} onChange={(e) => setTexts({ ...texts, [a.id]: e.target.value })}
            rows={Math.min(30, texts[a.id].split("\n").length + 1)} style={{ width: "100%", marginTop: 8, fontSize: 14, lineHeight: 1.6 }} />
          <div className="actions noprint">
            <button style={{ width: "auto" }} onClick={() => copy(a.id, texts[a.id])}>{done === a.id ? "✓ コピーしました" : "コピー"}</button>
            <button className="ghost" style={{ color: "var(--sub)", width: "auto" }} onClick={() => setTexts({ ...texts, [a.id]: a.body(url) })}>もとにもどす</button>
          </div>
        </section>
      ))}
    </>
  );
}
