"use client";
import { useState } from "react";

/** 「プリント」ボタン。押すと、その端末のプリント画面を開く。
 *  iPhoneのホーム画面アプリ（Safariの外）などでは、端末の仕組みで開けないことがあるため、そのときの案内も出す */
export function PrintButton({ label = "🖨 プリント" }: { label?: string }) {
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState("");
  const standalone = () => typeof navigator !== "undefined" && ((navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches);
  const mobile = () => typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);
  const go = () => {
    setNote("");
    try { window.print(); } catch { /* 下の案内を出す */ }
    if (mobile() || standalone()) setHelp(true);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(location.href); setNote("リンクをコピーしました。Safari（またはChrome）に貼りつけて開いてください。"); } catch { setNote("コピーできませんでした"); } };
  return (
    <>
      <button className="ghost noprint" style={{ width: "auto", margin: 0 }} onClick={go}>{label}</button>
      {help && (
        <div className="sheet-bg noprint" onClick={() => setHelp(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>プリント画面が出ないときは</h2>
            <ol style={{ lineHeight: 1.8, paddingLeft: 20 }}>
              <li><b>iPhone・iPad</b>：ホーム画面のアイコンからではなく、<b>Safari</b>でこのページを開きます。画面の下（または上）の<b>共有ボタン</b>（四角から矢印が出るマーク）→ <b>「プリント」</b>を押します。</li>
              <li><b>Android</b>：Chromeでこのページを開き、右上の「︙」→ <b>「共有」→「印刷」</b>を押します。</li>
              <li>パソコンの場合は、キーボードの <b>Ctrl＋P</b>（Macは <b>⌘＋P</b>）でも開きます。</li>
            </ol>
            <button onClick={copy}>このページのリンクをコピー</button>
            {note && <p className="sub"><b>{note}</b></p>}
            <button className="ghost" onClick={() => setHelp(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  );
}
