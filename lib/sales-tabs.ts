/** 「売上」の項目の中の切りかえ */
export function salesTabs(level: number, displayOnly = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/my-sales", label: "自分の売上（提出）", show: level < 4 && !displayOnly },
    { href: "/sales", label: level === 4 ? "全店の売上" : "自店の売上", show: level >= 3 && !displayOnly },
  ];
}
