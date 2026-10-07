/** 「メンター」の中の切りかえ（チャット／面談シート／占い／みんなのMBTI＝スタイリストだけ） */
export function mentorTabs(displayOnly = false, rank?: string | null): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/mentor", label: "チャット", show: !displayOnly },
    { href: "/interviews", label: "面談シート", show: !displayOnly },
    { href: "/mentor/fortune", label: "🔮 占い", show: !displayOnly },
    { href: "/mentor/mbti", label: "みんなのMBTI", show: !displayOnly },
  ];
}
