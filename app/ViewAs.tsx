"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import type { Me } from "@/lib/service";

/** アプリ制作者だけに出る「見え方の切りかえ」。ほかのレベルの人には、どの画面がどう見えるかを、自分で確かめられる */
export function ViewAs() {
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ key: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (["/login", "/setup"].includes(path)) { setMe(null); return; } api<Me>("/api/me").then(setMe).catch(() => setMe(null)); }, [path]);
  useEffect(() => { if (open && list.length === 0) api<{ key: string; label: string }[]>("/api/view-as").then(setList).catch(() => {}); }, [open, list.length]);
  if (!me?.canViewAs || typeof document === "undefined") return null;
  const pick = async (key: string | null) => {
    setBusy(true);
    try { await api("/api/view-as", { key }); location.href = "/home"; } catch { setBusy(false); }
  };
  return createPortal(
    <div className="noprint">
      <button className={`vas-chip ${me.viewAs ? "on" : ""}`} onClick={() => setOpen(true)} aria-label="見え方を切りかえる">
        👁 {me.viewAs ? `${me.viewAs.label.split("（")[0]}の見え方` : "見え方"}
      </button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>見え方を切りかえる</h3>
            <p className="sub">ほかのレベルの人には、画面がどう見えるかを、自分で確かめられます。権限も、そのレベルのとおりになります（見えない画面は見えない・できない操作はできない）。<b>ここでの操作は、本物のデータに入ります</b>ので、ためすときは気をつけてください。</p>
            <div className="seg" style={{ flexDirection: "column", gap: 6, alignItems: "stretch" }}>
              <button className={!me.viewAs ? "on" : ""} disabled={busy} onClick={() => pick(null)}>アプリ制作者（いつもの自分）</button>
              {list.map((p) => <button key={p.key} className={me.viewAs?.key === p.key ? "on" : ""} disabled={busy} onClick={() => pick(p.key)}>{p.label}</button>)}
            </div>
            <button className="ghost" onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </div>, document.body);
}
