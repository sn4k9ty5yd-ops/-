/** 「ミーティング」の中の切りかえ（会議の記録／AI会議／AI会議（僕専用）＝アプリ制作者だけ） */
export function meetingTabs(appOwner = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/meetings", label: "🎙 会議" },
    { href: "/councils", label: "🤖 AI会議" },
    { href: "/councils/private", label: "🔒 僕専用", show: appOwner },
  ];
}
