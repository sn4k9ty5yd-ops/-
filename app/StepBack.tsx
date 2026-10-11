"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { STATUS_LABEL, STATUS_ORDER, type PeriodStatus } from "@/lib/service";

/** 「ひとつ戻す」: シフトの進み具合を、ひとつ前の段階に戻す（シフト担当以上・自店）。DBでも権限を守っている */
export function StepBack({ periodId, storeId, status, onDone }: { periodId: string; storeId: string; status: string | undefined; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const i = status ? STATUS_ORDER.indexOf(status as PeriodStatus) : -1;
  if (i <= 0 || status === "preparing") return null;
  // 古いデータ用の「受付終了(closed)」は、とばして戻す
  let prev = STATUS_ORDER[i - 1]; if (prev === "closed") prev = "collecting";
  return (
    <span className="noprint">
      <button className="ghost" style={{ color: "var(--sub)", border: "1px solid var(--line, #ccc)", width: "auto", margin: "4px 0" }}
        onClick={async () => {
          if (!confirm(`「${STATUS_LABEL[status as PeriodStatus]}」から「${STATUS_LABEL[prev]}」に戻しますか？`)) return;
          try { await api("/api/periods", { periodId, storeId, status: prev }); setMsg(""); onDone(); } catch (e) { setMsg((e as Error).message); }
        }}>↩ ひとつ戻す（{STATUS_LABEL[prev]}へ）</button>
      {msg && <span className="err"> {msg}</span>}
    </span>
  );
}
