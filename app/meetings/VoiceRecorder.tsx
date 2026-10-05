"use client";
import { useEffect, useRef, useState } from "react";

/** ボイスメモ: しゃべった声を、その場で文字にする（スマホ・パソコンの中の機能。お金はかからない。声そのものは保存しない） */
type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function VoiceRecorder({ onFinal, disabled }: { onFinal: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [sec, setSec] = useState(0);
  const [msg, setMsg] = useState("");
  const rec = useRef<SR | null>(null);
  const want = useRef(false);

  useEffect(() => { setSupported(!!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition)); }, []);
  useEffect(() => { if (!on) return; const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, [on]);
  useEffect(() => () => { want.current = false; rec.current?.stop(); }, []);

  const make = () => {
    const W = window as unknown as Record<string, new () => SR>;
    const r = new (W.SpeechRecognition || W.webkitSpeechRecognition)();
    r.lang = "ja-JP"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { onFinal(t.trim()); } else tmp += t;
      }
      setInterim(tmp);
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { want.current = false; setOn(false); setMsg("マイクが使えません。ブラウザの設定で、マイクを許可してください。"); } };
    r.onend = () => { setInterim(""); if (want.current) { try { r.start(); } catch { /* すぐに再開できないときは、つぎの終了で再開 */ } } else setOn(false); };   // 途中で止まっても、押しているあいだは、つづける
    return r;
  };
  const start = () => { setMsg(""); setSec(0); want.current = true; rec.current = make(); try { rec.current.start(); setOn(true); } catch { setMsg("録音をはじめられませんでした。もう一度ためしてください。"); want.current = false; } };
  const stop = () => { want.current = false; rec.current?.stop(); setOn(false); setInterim(""); };

  if (!supported) return <p className="hint">このブラウザは、声の文字起こしに対応していません。iPhoneは「Safari」、Androidやパソコンは「Chrome」で開くと使えます。文字は、手で入れたり貼ったりもできます。</p>;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="toolbar" style={{ alignItems: "center" }}>
        {!on ? <button disabled={disabled} onClick={start}>🎙 ボイスメモをはじめる</button> : <button onClick={stop} style={{ background: "#d9363e" }}>■ とめる</button>}
        {on && <b style={{ color: "#d9363e" }}>● 録音中 {mm}:{ss}</b>}
      </div>
      {on && <p className="sub" style={{ margin: "6px 0 0" }}>{interim || "（話してください）"}</p>}
      <p className="sub" style={{ margin: "6px 0 0" }}>しゃべった声が、下の「文字起こし」に文字になって入ります。画面を閉じたり、スマホの画面が消えたりすると止まります。声そのものは保存しません。</p>
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}
