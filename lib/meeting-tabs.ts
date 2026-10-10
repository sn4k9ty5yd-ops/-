/** 「ミーティング」と「AI会議（僕専用）」の切りかえ（僕専用はアプリ制作者だけ。ほかの人には切りかえは出ない） */
export function meetingTabs(appOwner = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/meetings", label: "🎙 ミーティング" },
    { href: "/councils/private", label: "🔒 AI会議（僕専用）", show: appOwner },
  ];
}
