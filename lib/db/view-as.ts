/** アプリ制作者の「見え方の切りかえ」。サーバーの中だけにおぼえる（再起動すると、制作者の見え方にもどる） */
export interface ViewAsPreset { key: string; label: string; level: 1 | 2 | 3 | 4; rank: "stylist" | "assistant" | null; displayOnly: boolean; execView: boolean }
export const VIEW_AS_PRESETS: ViewAsPreset[] = [
  { key: "office", label: "正美さん（レベル5）", level: 4, rank: null, displayOnly: false, execView: false },
  { key: "president", label: "鬼塚さん（レベル4・見るだけ）", level: 4, rank: null, displayOnly: false, execView: true },
  { key: "manager", label: "店長（レベル3）", level: 3, rank: null, displayOnly: false, execView: false },
  { key: "shifter", label: "シフト担当（レベル2）", level: 2, rank: null, displayOnly: false, execView: false },
  { key: "stylist", label: "スタイリスト（レベル1）", level: 1, rank: "stylist", displayOnly: false, execView: false },
  { key: "assistant", label: "アシスタント（レベル1）", level: 1, rank: "assistant", displayOnly: false, execView: false },
  { key: "ipad", label: "お店のiPad（表示専用）", level: 1, rank: null, displayOnly: true, execView: false },
];
const g = globalThis as unknown as { __albumViewAs?: Map<string, ViewAsPreset> };
const map = (g.__albumViewAs ??= new Map());
export const getViewAs = (userId: string): ViewAsPreset | undefined => map.get(userId);
export function setViewAsKey(userId: string, key: string | null): ViewAsPreset | null {
  if (!key || key === "owner") { map.delete(userId); return null; }
  const p = VIEW_AS_PRESETS.find((x) => x.key === key);
  if (!p) throw new Error("見え方が正しくありません");
  map.set(userId, p); return p;
}
