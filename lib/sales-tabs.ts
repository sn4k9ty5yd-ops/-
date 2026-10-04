/** 「売上」の項目の中の切りかえ */
export function salesTabs(level: number, displayOnly = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/register-sales", label: "レジ売上", show: level >= 2 && !displayOnly },
    { href: "/sales", label: "歩合・目標", show: false },
  ];
}
