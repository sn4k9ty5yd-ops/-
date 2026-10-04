/** 「シフト」の項目の中の切りかえ。見られる人・使える人は、レベルで分かれる（データの権限はDB側でも守られている） */
export function shiftTabs(level: number): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/shifts", label: "シフトを見る" },
    { href: "/requests", label: "希望休" },
    { href: "/leave", label: "有給" },
    { href: "/admin/periods", label: "進み具合・締切", show: level >= 2 },
    { href: "/admin/requests", label: "みんなの休み", show: level >= 2 },
    { href: "/admin/shifts", label: "出勤簿", show: level >= 2 },
  ];
}
