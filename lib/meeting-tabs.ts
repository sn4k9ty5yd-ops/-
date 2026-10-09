/** 「議事録」と「AI会議」の切りかえ（僕専用はアプリ制作者だけ） */
export function meetingTabs(appOwner = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/meetings", label: "🎙 議事録" },
    { href: "/councils", label: "🤖 AI会議" },
    { href: "/councils/private", label: "🔒 AI会議（僕専用）", show: appOwner },
  ];
}
