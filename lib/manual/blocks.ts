/** マニュアルのページの中身（ブロックの並び）。Notionのページを、このかたちに変えて保存する。 */
export type Block = BlockBody & { id?: string };   // id は、書き込み（チェック・表のマス）の場所を決めるための印
export type BlockBody =
  | { t: "h"; l: 1 | 2 | 3 | 4; x: string; color?: string; children?: Block[] }
  | { t: "p"; x: string; color?: string; children?: Block[] }
  | { t: "ul" | "ol"; x: string; children?: Block[] }
  | { t: "todo"; x: string; checked?: boolean; children?: Block[] }
  | { t: "quote"; x: string; children?: Block[] }
  | { t: "hr" }
  | { t: "code"; x: string; lang?: string }
  | { t: "callout"; icon: string; color: string; x?: string; children: Block[] }
  | { t: "toggle"; x: string; color?: string; children: Block[] }
  | { t: "cols"; cols: Block[][] }
  | { t: "table"; header: boolean; headerCol?: boolean; rows: string[][]; choices?: (string[] | null)[]; edit?: boolean; tap?: boolean }   // tap: マスを押すと「✓」がつく／消える表（帰りのチェック表など）。 choices: 列ごとの選べる値（点数など）／edit: 書き込める人が、マスに入力できる表（評価表など）
  | { t: "img"; src: string; cap?: string }
  | { t: "video"; url: string }
  | { t: "file"; src: string; name: string }
  | { t: "link"; url: string; x: string }
  | { t: "child"; ref: string; title: string; icon?: string }   // 子ページへのリンク（ref = 取り込み元のID）
  | { t: "db"; ref: string; title: string };                    // データベース（行のページは、子ページとして並べる）

/** "asset:<uuid>" は、アプリの中に保存した画像・ファイル */
export const assetUrl = (src: string) => (src.startsWith("asset:") ? `/api/manual/assets/${src.slice(6)}` : src);

/** ブロックの中の画像・ファイルの場所を、すべて入れ替える（取り込み時に、保存した場所に直すため） */
export async function mapSources(blocks: Block[], fn: (src: string, kind: "img" | "file") => Promise<string>): Promise<Block[]> {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.t === "img") out.push({ ...b, src: await fn(b.src, "img") });
    else if (b.t === "file") out.push({ ...b, src: await fn(b.src, "file") });
    else if (b.t === "cols") out.push({ ...b, cols: await Promise.all(b.cols.map((c) => mapSources(c, fn))) });
    else if ("children" in b && b.children) out.push({ ...b, children: await mapSources(b.children, fn) } as Block);
    else out.push(b);
  }
  return out;
}

export function collectSources(blocks: Block[], acc: { src: string; kind: "img" | "file" }[] = []) {
  for (const b of blocks) {
    if (b.t === "img") acc.push({ src: b.src, kind: "img" });
    else if (b.t === "file") acc.push({ src: b.src, kind: "file" });
    else if (b.t === "cols") b.cols.forEach((c) => collectSources(c, acc));
    else if ("children" in b && b.children) collectSources(b.children, acc);
  }
  return acc;
}

/** 検索用に、ブロックの文字だけを取り出す */
export function plainText(blocks: Block[]): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\*\*|~~|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const parts: string[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if ("x" in b && b.x) parts.push(strip(b.x));
      if (b.t === "table") b.rows.forEach((r) => r.forEach((c) => parts.push(strip(c))));
      if (b.t === "cols") b.cols.forEach(walk);
      if ("children" in b && b.children) walk(b.children);
    }
  };
  walk(blocks);
  return parts.join(" ");
}

/** 書き込みできる場所（チェック・書き込み用の表）が、ページにあるか */
export function hasEditable(blocks: Block[]): boolean {
  return blocks.some((b) => b.t === "todo" || (b.t === "table" && !!b.edit) || (b.t === "cols" && b.cols.some(hasEditable)) || ("children" in b && !!b.children && hasEditable(b.children)));
}

/** ページの中の表を、すべて書き込める表にする（評価表のページ用） */
export function markTablesEditable(blocks: Block[]): Block[] {
  return blocks.map((b) => b.t === "table" ? { ...b, edit: true } : b.t === "cols" ? { ...b, cols: b.cols.map(markTablesEditable) } : "children" in b && b.children ? ({ ...b, children: markTablesEditable(b.children) } as Block) : b);
}

/** 書き込みできるブロック（チェック・表のマス）に、印(id)をつける。すでにあるものは変えない */
export function assignIds(blocks: Block[], gen: () => string = () => Math.random().toString(36).slice(2, 10)): Block[] {
  const used = new Set<string>();
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if ((b.t === "todo" || b.t === "table") && !b.id) { let id = gen(); while (used.has(id)) id = gen(); b.id = id; }
      if (b.id) used.add(b.id);
      if (b.t === "cols") b.cols.forEach(walk);
      if ("children" in b && b.children) walk(b.children);
    }
  };
  walk(blocks);
  return blocks;
}
