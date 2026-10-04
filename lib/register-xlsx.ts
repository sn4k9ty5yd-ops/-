import { COUNT_KEYS, COUNT_LABELS, GROUPS, MONEY_KEYS, ratioOf, SUB_LABELS, totalsOf, type RegisterRow } from "./register-sales";

export interface RegisterXlsxMeta { storeName: string; month: string; start: string; end: string; days: number; confirmed: boolean }

/** レジの「月間スタッフ売上表」と同じ並び・同じ言葉のエクセルを作る（中身は xlsx のバイト列） */
export async function buildRegisterXlsx(rows: RegisterRow[], meta: RegisterXlsxMeta): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const total = totalsOf(rows);
  const head1 = ["スタッフ", ...GROUPS.flatMap((g) => [g.label, "", "", ""]), "売上比率", ...COUNT_KEYS.map((k) => COUNT_LABELS[k])];
  // 新規〜合計客数は、見出しを1段目に。2段目は、技術・商品・総合の中の見出し
  const head2 = ["", ...GROUPS.flatMap(() => SUB_LABELS), "", ...COUNT_KEYS.map(() => "")];
  const aoa: (string | number)[][] = [
    [`${meta.storeName}　月間スタッフ売上表`],
    [`期間：${meta.start} 〜 ${meta.end}　稼働日数：${meta.days}日　【税抜】　${meta.confirmed ? "（事務員さん確認済み）" : "（確認前）"}`],
    [],
    head1, head2,
    ...rows.map((r) => [r.name, ...MONEY_KEYS.map((k) => r[k]), ratioOf(r, rows) / 100, ...COUNT_KEYS.map((k) => r[k])]),
    ["合計", ...MONEY_KEYS.map((k) => total[k]), "", ...COUNT_KEYS.map((k) => total[k])],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastCol = 1 + 12 + 1 + COUNT_KEYS.length - 1;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
    { s: { r: 3, c: 1 }, e: { r: 3, c: 4 } }, { s: { r: 3, c: 5 }, e: { r: 3, c: 8 } }, { s: { r: 3, c: 9 }, e: { r: 3, c: 12 } },
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } }, { s: { r: 3, c: 13 }, e: { r: 4, c: 13 } },
    ...COUNT_KEYS.map((_, i) => ({ s: { r: 3, c: 14 + i }, e: { r: 4, c: 14 + i } })),
  ];
  ws["!cols"] = [{ wch: 16 }, ...Array.from({ length: lastCol }, () => ({ wch: 11 }))];
  // 金額は「#,##0」、売上比率は「0.0%」
  const first = 5;
  for (let r = first; r < first + rows.length + 1; r++) {
    for (let c = 1; c <= 12; c++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = "#,##0"; }
    const pc = ws[XLSX.utils.encode_cell({ r, c: 13 })]; if (pc && typeof pc.v === "number") pc.z = "0.0%";
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, meta.month);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

/** ブラウザで、エクセルのファイルをダウンロードさせる */
export async function downloadRegisterXlsx(rows: RegisterRow[], meta: RegisterXlsxMeta): Promise<void> {
  const bytes = await buildRegisterXlsx(rows, meta);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `レジ売上_${meta.storeName}_${meta.month}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
