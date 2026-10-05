"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** 1つの項目にまとめた画面の、上の切りかえ（例：希望休／有給） */
export function SubTabs({ items }: { items: { href: string; label: string; show?: boolean; also?: string[]; small?: boolean }[] }) {
  const path = usePathname();
  const list = items.filter((i) => i.show !== false);
  if (list.length < 2) return null;
  const len = (i: (typeof list)[number]) => Math.max(0, ...[i.href, ...(i.also ?? [])].filter((h) => path === h || path.startsWith(h + "/")).map((h) => h.length));
  const best = Math.max(0, ...list.map(len));   // いちばん長く合う1つだけ光らせる（/material と /material/stock が両方光らないように）
  return (
    <nav className="tabs noprint" style={{ margin: "4px 0 12px" }}>
      {list.map((i) => <Link key={i.href} href={i.href} className={best > 0 && len(i) === best ? "on" : ""} style={i.small ? { fontSize: 13 } : undefined}>{i.label}</Link>)}
    </nav>
  );
}
