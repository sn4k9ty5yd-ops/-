/** 「シフト」の項目の中の切りかえ（3つだけ）。「つくる」はシフト担当・店長・事務員さんだけ。データの権限はDB側でも守られている */
export function shiftTabs(level: number): { href: string; label: string; show?: boolean; also?: string[] }[] {
  return [
    { href: "/shifts", label: "見る" },
    { href: "/requests", label: "出す", also: ["/leave"] },
    { href: "/admin/periods", label: "つくる", also: ["/admin/shifts", "/admin/attendance"], show: level >= 2 },
  ];
}
