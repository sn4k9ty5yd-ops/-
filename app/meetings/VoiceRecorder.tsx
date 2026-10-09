"use client";
import { useEffect, useRef, useState } from "react";

/** ボイスメモ: しゃべった声を、その場で文字にする（スマホ・パソコンの中の機能。お金はかからない。声そのものは保存しない） */
type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort?(): void; onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function VoiceRecorder({ onFinal, onInterim, onState, disabled }: { onFinal: (text: string) => void; onInterim?: (text: string) => void; onState?: (on: boolean) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [sec, setSec] = useState(0);
  const [msg, setMsg] = useState("");
  const rec = useRef<SR | null>(null);
  const want = useRef(false);
  // 最新の関数をおぼえておく（認識の途中で、画面の更新があっても、古い関数を呼ばないように）
  const fin = useRef(onFinal); fin.current = onFinal;
  const inter = useRef(onInterim); inter.current = onInterim;
  const st = useRef(onState); st.current = onState;
  const ends = useRef<number[]>([]);   // 終わった時刻（すぐ終わる→再開をくり返して、画面が固まるのを防ぐ）
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setRun = (v: boolean) => { setOn(v); st.current?.(v); };

  useEffect(() => { setSupported(!!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition)); }, []);
  useEffect(() => { if (!on) return; const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, [on]);
  useEffect(() => () => { want.current = false; if (timer.current) clearTimeout(timer.current); try { rec.current?.abort?.(); } catch { /* 何もしない */ } }, []);

  const make = () => {
    const W = window as unknown as Record<string, new () => SR>;
    const r = new (W.SpeechRecognition || W.webkitSpeechRecognition)();
    r.lang = "ja-JP"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { fin.current(t.trim()); ends.current = []; } else tmp += t;
      }
      setInterim(tmp); inter.current?.(tmp);
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { want.current = false; setRun(false); setMsg("マイクが使えません。ブラウザの設定で、マイクを許可してください。"); } };
    r.onend = () => {
      setInterim(""); inter.current?.("");
      if (!want.current) { setRun(false); return; }
      // 途中で止まっても、押しているあいだは、少し待ってからつづける。すぐ終わるのが続くときは、あきらめて止める（固まり防止）
      const now = Date.now(); ends.current = [...ends.current.filter((t) => now - t < 4000), now];
      if (ends.current.length >= 5) { want.current = false; setRun(false); setMsg("声をうまく聞きとれませんでした。もう一度「はじめる」を押してください。"); return; }
      timer.current = setTimeout(() => { if (!want.current) return; try { r.start(); } catch { /* つぎの終了で、もう一度ためす */ } }, 350);
    };
    return r;
  };
  const start = () => { setMsg(""); setSec(0); ends.current = []; want.current = true; rec.current = make(); try { rec.current.start(); setRun(true); } catch { setMsg("録音をはじめられませんでした。もう一度ためしてください。"); want.current = false; } };
  const stop = () => { want.current = false; if (timer.current) clearTimeout(timer.current); try { rec.current?.stop(); } catch { /* 何もしない */ } try { rec.current?.abort?.(); } catch { /* 何もしない */ } setRun(false); setInterim(""); inter.current?.(""); };

  if (!supported) return <p className="hint">このブラウザは、声の文字起こしに対応していません。iPhoneは「Safari」、Androidやパソコンは「Chrome」で開くと使えます。文字は、手で入れたり貼ったりもできます。</p>;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="toolbar" style={{ alignItems: "center" }}>
        {!on ? <button disabled={disabled} onClick={start}>🎙 ボイスメモをはじめる</button> : <button onClick={stop} onPointerDown={(e) => { if (e.pointerType === "touch") { e.preventDefault(); stop(); } }} style={{ background: "#d9363e", touchAction: "manipulation" }}>■ とめる</button>}
        {on && <b style={{ color: "#d9363e" }}>● 録音中 {mm}:{ss}</b>}
      </div>
      {on && <p className="sub" style={{ margin: "6px 0 0" }}>{interim || "（話してください）"}</p>}
      <p className="sub" style={{ margin: "6px 0 0" }}>しゃべった声が、下の「文字起こし」に文字になって入ります。画面を閉じたり、スマホの画面が消えたりすると止まります。声そのものは保存しません。</p>
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}
