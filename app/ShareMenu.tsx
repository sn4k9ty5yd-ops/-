"use client";
import { useState } from "react";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
}

/** 「印刷」の代わり。iPhoneでは印刷が使いにくいので、3つのやり方からえらべる:
 *  ① この端末にコピー（iPhoneのコピー） ② リンクをメールで送る（パソコンで開く） ③ 近くの端末へ送る（AirDrop・Bluetoothなど） */
export function ShareMenu({ title, text, link, label = "印刷・送る" }: { title: string; text: string; link?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const url = link ?? (typeof location !== "undefined" ? location.href : "");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const big = { display: "block", width: "100%", textAlign: "left", padding: "14px 16px", margin: "8px 0", fontSize: 16 } as const;
  return (
    <>
      <button className="ghost noprint" style={{ color: "var(--ink)" }} onClick={() => { setNote(""); setOpen(true); }}>{label}</button>
      {open && (
        <div className="sheet-bg noprint" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>{label}</h2>
            <p className="sub">つかい方を、えらんでください。</p>
            <button style={big} onClick={async () => setNote((await copyText(text)) ? "コピーしました。メモ・メール・LINE・Excelなどに、貼りつけられます。" : "コピーできませんでした")}>
              📋 この端末にコピーする<br /><small style={{ fontWeight: 400 }}>iPhoneのコピー。貼りつけて、使えます</small>
            </button>
            <a style={{ ...big, textDecoration: "none", background: "var(--blue, #2563eb)", color: "#fff", borderRadius: 14, boxSizing: "border-box" }}
              href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n\nパソコンで開いて、見たり、印刷したりできます。\n${url}\n\n（ログインが必要です）`)}`}>
              ✉ リンクをメールで送る<br /><small style={{ fontWeight: 400 }}>パソコンでメールを開いて、リンクを押すと、パソコンで見られます</small>
            </a>
            <button style={big} disabled={!canShare} onClick={async () => { try { await navigator.share({ title, text }); setNote("送りました"); } catch (e) { if ((e as Error).name !== "AbortError") setNote("送れませんでした"); } }}>
              📲 近くの端末へ送る（AirDrop・Bluetooth）<br /><small style={{ fontWeight: 400 }}>{canShare ? "送り先を選ぶ画面が出ます（近くのiPhone・Macなど）" : "この端末・ブラウザでは使えません（iPhoneのSafariなどで使えます）"}</small>
            </button>
            {typeof window !== "undefined" && !/iPhone|iPad|Android/i.test(navigator.userAgent) && (
              <button className="ghost" style={big} onClick={() => window.print()}>🖨 このパソコンで印刷する</button>
            )}
            {note && <p className="sub"><b>{note}</b></p>}
            <button className="ghost" onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  );
}
