"use client";
import { useState } from "react";
import { GUIDES } from "@/lib/guides";

export default function GuidePage() {
  const [id, setId] = useState(GUIDES[0].id);
  const g = GUIDES.find((x) => x.id === id)!;
  const text = `${g.title}\n\n${g.lead}\n\n` + g.sections.map((s) => `■ ${s.h}\n${s.p.join("\n")}${s.list ? "\n" + s.list.map((l) => `・${l}`).join("\n") : ""}`).join("\n\n");
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2500); } catch { /* 何もしない */ } };
  return (
    <>
      <h1>アプリの説明書</h1>
      <div className="actions noprint" style={{ marginBottom: 12 }}>
        {GUIDES.map((x) => <button key={x.id} className={x.id === id ? "" : "ghost"} style={{ width: "auto", color: x.id === id ? undefined : "var(--ink)" }} onClick={() => setId(x.id)}>{x.to}向け</button>)}
        <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={copy}>{done ? "✓ コピーしました" : "全文コピー"}</button>
        <button className="ghost" style={{ width: "auto", color: "var(--ink)" }} onClick={() => window.print()}>印刷・PDF</button>
      </div>
      <article className="card guide">
        <h2 style={{ marginTop: 0 }}>{g.title}</h2>
        <p className="sub">{g.lead}</p>
        {g.sections.map((s) => (
          <section key={s.h} style={{ marginTop: 18 }}>
            <h3>{s.h}</h3>
            {s.p.map((t, i) => <p key={i} style={{ lineHeight: 1.8 }}>{t}</p>)}
            {s.list && <ul style={{ lineHeight: 1.8 }}>{s.list.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </section>
        ))}
      </article>
    </>
  );
}
