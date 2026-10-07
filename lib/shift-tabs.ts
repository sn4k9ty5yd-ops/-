/** 「シフト」の項目の中の切りかえ（3つだけ）。「つくる」はシフト担当・店長・事務員さんだけ。データの権限はDB側でも守られている */
export function shiftTabs(level: number): { href: string; label: string; show?: boolean; also?: string[] }[] {
  return [
    { href: "/shifts", label: "見る", also: ["/admin/shifts", "/admin/attendance"] },
    { href: "/requests", label: "出す", also: ["/leave"] },
    { href: "/admin/periods", label: "つくる", show: level >= 2 },
  ];
}

/** 「見る」の中の切りかえ（シフトのカレンダー／出勤簿予定／出勤簿確定）。出勤簿の2枚は、シフト担当以上だけ */
export function viewTabs(level: number): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/shifts", label: "シフト" },
    { href: "/admin/shifts", label: "出勤簿予定", show: level >= 2 },
    { href: "/admin/attendance", label: "出勤簿確定", show: level >= 2 },
  ];
}
