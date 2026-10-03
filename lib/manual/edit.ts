import type { Block } from "./blocks";

export type EditOp =
  | { op: "todo"; id: string; checked: boolean }
  | { op: "cell"; id: string; r: number; c: number; text: string };

const MAX_CELL = 500;

function find(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    const hit = b.t === "cols" ? b.cols.map((c) => find(c, id)).find(Boolean) ?? null : "children" in b && b.children ? find(b.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** 書き込みを、ページの中身に反映する（元の配列は変えず、変えた写しを返す）。表のマスは、選べる値がある列ではその値だけ */
export function applyOp(body: Block[], op: EditOp): { body: Block[]; summary: string } {
  const next = structuredClone(body);
  const b = find(next, op.id);
  if (!b) throw new Error("書き込む場所が見つかりません（ページが更新されたかもしれません）");
  if (op.op === "todo") {
    if (b.t !== "todo") throw new Error("チェックの場所が違います");
    b.checked = !!op.checked;
    return { body: next, summary: `チェック「${b.x.replace(/<[^>]+>/g, "").slice(0, 30)}」を${b.checked ? "つけた" : "外した"}` };
  }
  if (b.t !== "table") throw new Error("表の場所が違います");
  const row = b.rows[op.r];
  if (!row || op.c < 0 || op.c >= row.length) throw new Error("表のマスが見つかりません");
  const text = String(op.text ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_CELL);
  const choices = b.choices?.[op.c];
  if (choices && text !== "" && !choices.includes(text)) throw new Error("選べる値ではありません");
  row[op.c] = text;
  const head = (b.rows[0]?.[op.c] ?? "").replace(/<[^>]+>/g, "");
  const who = (row[0] ?? "").replace(/<[^>]+>/g, "");
  return { body: next, summary: `表「${who}／${head}」を「${text}」にした` };
}
