import type { Level } from "./permissions";

export interface StoreRef { id: string; name: string; }
export interface ParsedStaff { line: number; name: string; employeeCode: string; storeId: string | null; storeName: string; level: Level; error: string | null; }
export interface StaffPasteResult { rows: ParsedStaff[]; skippedHeader: boolean; }

const nfkc = (s: string) => s.normalize("NFKC").trim();
const norm = (s: string) => nfkc(s).replace(/\s+/g, "").toLowerCase();

const LEVEL_WORDS: [RegExp, Level][] = [
  [/^(1|スタッフ|一般|一般スタッフ)$/, 1], [/^(2|シフト担当|シフト|リーダー)$/, 2], [/^(3|店長)$/, 3], [/^(4|オフィス|管理者|事務|事務員)$/, 4],
];
export const parseLevel = (raw: string): Level | null => { const t = norm(raw); for (const [re, lv] of LEVEL_WORDS) if (re.test(t)) return lv; return null; };

export const CODE_RE = /^[A-Za-z0-9]{1,20}$/;

/**
 * Excel などからコピーした表（タブ区切り。カンマ区切りも可）を、スタッフの登録内容に変換する。
 * 列の順番は「名前・社員番号・お店・レベル」。お店を省くと、画面で選んだお店になる。レベルを省くとスタッフ(1)。
 * 3列目が「店長」などのレベルの言葉で、お店の名前ではないときは、レベルとして読む。
 * 最初の行が見出し（「名前」「社員番号」など）なら、見出しの言葉で列を決める（メールアドレスなど知らない列は読み飛ばす）。
 * 見出しがないときも、メールアドレス（@を含む列）は無視する。
 */
export function parseStaffPaste(text: string, stores: StoreRef[], opts: { defaultStoreId?: string; canAssignLevel: boolean }): StaffPasteResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const byName = new Map(stores.map((s) => [norm(s.name), s]));
  const seen = new Set<string>();
  const rows: ParsedStaff[] = []; let skippedHeader = false;
  const split = (line: string) => (line.includes("\t") ? line.split("\t") : line.split(/[,，]/)).map((c) => c.trim());

  // 見出し行があれば、見出しの言葉で列を決める（メールアドレスなど、知らない列は読み飛ばす）
  const head = lines.length ? split(lines[0]).map(norm) : [];
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const hName = find(/^(名前|氏名|名|name)$/), hCode = find(/^(社員番号|社員no|社員id|番号|id|従業員番号)$/);
  const hStore = find(/^(お店|店舗|店|所属|店名|店舗名)$/), hLevel = find(/^(レベル|権限|役職|level)$/);
  const hasHeader = hName >= 0 || hCode >= 0;

  lines.forEach((line, i) => {
    let cols = split(line);
    let name: string, codeRaw: string, storeCol: string, levelCol: string;
    if (i === 0 && hasHeader) { skippedHeader = true; return; }
    if (hasHeader) {
      name = cols[hName >= 0 ? hName : 0] ?? ""; codeRaw = cols[hCode >= 0 ? hCode : 1] ?? "";
      storeCol = hStore >= 0 ? (cols[hStore] ?? "") : ""; levelCol = hLevel >= 0 ? (cols[hLevel] ?? "") : "";
    } else {
      cols = cols.filter((c) => !c.includes("@"));                 // メールアドレスは無視する
      [name = "", codeRaw = "", storeCol = "", levelCol = ""] = cols;
    }
    const employeeCode = nfkc(codeRaw);
    if (storeCol && !byName.has(norm(storeCol)) && parseLevel(storeCol) !== null && !levelCol) { levelCol = storeCol; storeCol = ""; }   // 3列目がレベルの言葉
    const store = storeCol ? byName.get(norm(storeCol)) : stores.find((s) => s.id === opts.defaultStoreId);
    const level = levelCol ? parseLevel(levelCol) : 1;
    let error: string | null = null;
    if (!name) error = "名前がありません";
    else if (name.length > 50) error = "名前が長すぎます";
    else if (!employeeCode) error = "社員番号がありません";
    else if (!CODE_RE.test(employeeCode)) error = "社員番号は、英数字（20文字まで）にしてください";
    else if (seen.has(employeeCode)) error = "同じ社員番号が、この表の中に2つあります";
    else if (!store) error = storeCol ? `お店「${storeCol}」が見つかりません` : "お店を選んでください";
    else if (level === null) error = `レベル「${levelCol}」が読めません（スタッフ・シフト担当・店長・オフィス）`;
    else if (level > 1 && !opts.canAssignLevel) error = "スタッフより上のレベルを決められるのは、管理者だけです";
    if (employeeCode) seen.add(employeeCode);
    rows.push({ line: i + 1, name, employeeCode, storeId: store?.id ?? null, storeName: store?.name ?? storeCol, level: (level ?? 1) as Level, error });
  });
  return { rows, skippedHeader };
}
