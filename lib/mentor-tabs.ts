/** 「メンター」の中の切りかえ（チャット／面談シート） */
export function mentorTabs(displayOnly = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/mentor", label: "チャット", show: !displayOnly },
    { href: "/interviews", label: "面談シート", show: !displayOnly },
  ];
}
