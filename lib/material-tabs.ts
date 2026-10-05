/** 「材料費」の中の切りかえ（発注額／在庫／テスター／スタッフ購入） */
export function materialTabs(displayOnly = false): { href: string; label: string; show?: boolean }[] {
  return [
    { href: "/material", label: "発注額", show: !displayOnly },
    { href: "/material/stock", label: "在庫", show: !displayOnly },
    { href: "/material/tester", label: "テスター（業務に回した分）", show: !displayOnly },
    { href: "/material/staff-buy", label: "スタッフ購入", show: !displayOnly },
  ];
}
