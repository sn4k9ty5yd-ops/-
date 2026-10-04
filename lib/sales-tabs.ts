/** 「売上」の項目の中の切りかえ */
export function salesTabs(level: number, displayOnly = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/my-sales", label: "自分の売上", show: level < 4 && !displayOnly },
    { href: "/sales", label: "売上の確認・歩合", show: level >= 2 },
    { href: "/register-sales", label: "レジ売上", show: !displayOnly },
  ];
}
