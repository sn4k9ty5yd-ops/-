"use client";
import { useState } from "react";

/** 「プリント」ボタン。押すと、その端末のプリント画面を開く。
 *  iPhoneのホーム画面アプリ（Safariの外）などでは、端末の仕組みで開けないことがあるため、そのときの案内も出す */
export function PrintButton({ label = "🖨 プリント", fit, a4 }: { label?: string; fit?: string; a4?: "portrait" | "landscape" }) {
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState("");
  const standalone = () => typeof navigator !== "undefined" && ((navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches);
  const mobile = () => typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);
  const go = () => {
    setNote("");
    const undo = fit ? fitToA4(fit) : a4 ? setPage(a4) : () => {};
    const done = () => { undo(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    try { window.print(); } catch { /* 下の案内を出す */ }
    if (!(mobile() || standalone())) setTimeout(() => { /* print()が戻ったら元に戻す（afterprintが来ない端末用） */ done(); }, 0);
    else setHelp(true);
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

/** 紙の大きさ・向き（A4）を決める。表は縮めず、何枚でも続けて印刷する。戻す関数を返す */
function setPage(dir: "portrait" | "landscape"): () => void {
  const st = document.createElement("style");
  st.textContent = `@media print{@page{size:A4 ${dir};margin:12mm 10mm 14mm;@bottom-center{content:counter(page) " / " counter(pages);font-size:9pt}}}`;
  document.head.appendChild(st);
  return () => st.remove();
}

/** 表をA4の1枚に収める。紙の向き（横／縦）を、大きく印刷できるほうに自動で決める。戻す関数を返す */
function fitToA4(sel: string): () => void {
  const table = document.querySelector<HTMLElement>(sel);
  if (!table) return () => {};
  table.classList.add("pfit");
  (table as HTMLElement).style.zoom = "1";
  // スマホでは表が隠れている（カード表示）ので、はかる間だけ、見えない場所に出す
  const host = table.closest<HTMLElement>(".stwide");
  const prev = host ? host.getAttribute("style") : null;
  if (host && host.offsetParent === null) host.setAttribute("style", "display:block !important;position:absolute;left:-99999px;top:0;width:1100px;visibility:hidden");
  const w = table.scrollWidth, h = table.scrollHeight;
  if (host) { if (prev === null) host.removeAttribute("style"); else host.setAttribute("style", prev); }
  const HEAD = 60, MM = 3.7795;           // 見出しの分と、1mmあたりのpx
  const land = Math.min(1, ((297 - 16) * MM) / w, ((210 - 16) * MM - HEAD) / h);
  const port = Math.min(1, ((210 - 16) * MM) / w, ((297 - 16) * MM - HEAD) / h);
  const useLand = land >= port;
  table.style.zoom = String(Math.max(0.2, (useLand ? land : port) * 0.98));
  const st = document.createElement("style");
  st.textContent = `@media print{@page{size:A4 ${useLand ? "landscape" : "portrait"};margin:8mm}}`;
  document.head.appendChild(st);
  return () => { table.style.zoom = ""; table.classList.remove("pfit"); st.remove(); };
}
