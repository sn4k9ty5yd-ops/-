/** レジ売上（レジの「月間スタッフ売上表」と同じ形・同じ言葉）。計算と貼り付けの読み取り。 */
export interface RegisterRow {
  name: string;
  techBefore: number; techDiscount: number; techTax: number; techTotal: number;
  goodsBefore: number; goodsDiscount: number; goodsTax: number; goodsTotal: number;
  allBefore: number; allDiscount: number; allTax: number; allTotal: number;
  newCount: number; repeatCount: number; fixedCount: number; gobusataCount: number; guestCount: number; totalCount: number;
}
export type RegisterKey = Exclude<keyof RegisterRow, "name">;

/** 表の列の順番（スタッフ名のあと）。レジの表と同じ並び */
export const MONEY_KEYS: RegisterKey[] = ["techBefore", "techDiscount", "techTax", "techTotal", "goodsBefore", "goodsDiscount", "goodsTax", "goodsTotal", "allBefore", "allDiscount", "allTax", "allTotal"];
export const COUNT_KEYS: RegisterKey[] = ["newCount", "repeatCount", "fixedCount", "gobusataCount", "guestCount", "totalCount"];
export const ALL_KEYS: RegisterKey[] = [...MONEY_KEYS, ...COUNT_KEYS];

/** レジの見出しの言葉 */
export const GROUPS: { label: string; keys: RegisterKey[] }[] = [
  { label: "技術", keys: ["techBefore", "techDiscount", "techTax", "techTotal"] },
  { label: "商品", keys: ["goodsBefore", "goodsDiscount", "goodsTax", "goodsTotal"] },
  { label: "総合", keys: ["allBefore", "allDiscount", "allTax", "allTotal"] },
];
export const SUB_LABELS = ["値引前", "値引", "消費税", "合計"];
export const COUNT_LABELS: Record<string, string> = { newCount: "新規", repeatCount: "再来", fixedCount: "固定", gobusataCount: "ごぶさた", guestCount: "ゲスト", totalCount: "合計客数" };
export const SORTS = [
  { id: "order", label: "スタッフ表示順" }, { id: "tech", label: "技術順" }, { id: "goods", label: "商品順" },
  { id: "all", label: "総合順" }, { id: "ratio", label: "売上比率順" }, { id: "customers", label: "合計客数順" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];

export const emptyRow = (name = ""): RegisterRow => ({
  name, techBefore: 0, techDiscount: 0, techTax: 0, techTotal: 0, goodsBefore: 0, goodsDiscount: 0, goodsTax: 0, goodsTotal: 0,
  allBefore: 0, allDiscount: 0, allTax: 0, allTotal: 0, newCount: 0, repeatCount: 0, fixedCount: 0, gobusataCount: 0, guestCount: 0, totalCount: 0,
});

export function totalsOf(rows: RegisterRow[]): RegisterRow {
  const t = emptyRow("合計");
  for (const r of rows) for (const k of ALL_KEYS) t[k] += r[k];
  return t;
}

/** 売上比率（％・小数1けた）。全員の「総合 合計」にしめる、その人の「総合 合計」 */
export function ratioOf(row: RegisterRow, rows: RegisterRow[]): number {
  const sum = rows.reduce((s, r) => s + r.allTotal, 0);
  return sum > 0 ? Math.round((row.allTotal / sum) * 1000) / 10 : 0;
}

export function sortRows<T extends RegisterRow>(rows: T[], by: SortId): T[] {
  const key: Record<SortId, (r: T) => number> = {
    order: () => 0, tech: (r) => r.techTotal, goods: (r) => r.goodsTotal, all: (r) => r.allTotal, ratio: (r) => r.allTotal, customers: (r) => r.totalCount,
  };
  if (by === "order") return rows;
  return [...rows].sort((a, b) => key[by](b) - key[by](a));
}

/** 数字の合い方の確認（レジの表は、この関係がいつも成り立つ）。合わない所の名前を返す */
export function checkRow(r: RegisterRow): string[] {
  const w: string[] = [];
  if (r.techBefore - r.techDiscount + r.techTax !== r.techTotal) w.push("技術の合計");
  if (r.goodsBefore - r.goodsDiscount + r.goodsTax !== r.goodsTotal) w.push("商品の合計");
  if (r.allBefore - r.allDiscount + r.allTax !== r.allTotal) w.push("総合の合計");
  if (r.techTotal + r.goodsTotal !== r.allTotal) w.push("技術＋商品＝総合");
  if (r.newCount + r.repeatCount + r.fixedCount + r.gobusataCount + r.guestCount !== r.totalCount) w.push("合計客数");
  return w;
}

const NUM = /^-?[\d,，.]+%?$|^[-－ー]$/;
const toNum = (t: string): number => {
  if (/^[-－ー]$/.test(t)) return 0;
  const n = Number(t.replace(/[,，%]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * レジの表をコピー（または、直した表）を貼ったものを読む。1行＝1人。
 * 名前のあとに、数字が 18個（技術4・商品4・総合4・新規・再来・固定・ごぶさた・ゲスト・合計客数）、
 * または 19個（総合のあとに「売上比率」が入っているとき）。タブでも、空白でも区切れる。
 */
export function parseRegisterPaste(text: string): { rows: RegisterRow[]; skipped: string[] } {
  const rows: RegisterRow[] = []; const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/[\t 　]+/).filter(Boolean);
    let i = 0; while (i < tokens.length && !NUM.test(tokens[i])) i++;
    const name = tokens.slice(0, i).join(" ");
    const nums = tokens.slice(i);
    if (!name || name === "合計") { if (name !== "合計" && nums.length) skipped.push(line); continue; }
    if (nums.length !== 18 && nums.length !== 19) { skipped.push(line); continue; }
    const v = nums.map(toNum);
    const money = v.slice(0, 12);
    const rest = nums.length === 19 ? v.slice(13) : v.slice(12);   // 売上比率をとばす
    const r = emptyRow(name);
    MONEY_KEYS.forEach((k, j) => { r[k] = money[j]; });
    COUNT_KEYS.forEach((k, j) => { r[k] = rest[j]; });
    rows.push(r);
  }
  return { rows, skipped };
}

/** 表をコピー（タブ区切り）。貼り付けでもどせる形 */
export function registerToTsv(rows: RegisterRow[]): string {
  return rows.map((r) => [r.name, ...ALL_KEYS.map((k) => String(r[k]))].join("\t")).join("\n");
}

/** 月 'YYYY-MM' の最初の日と最後の日 */
export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}
