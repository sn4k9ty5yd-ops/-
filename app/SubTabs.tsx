"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** 1つの項目にまとめた画面の、上の切りかえ（例：希望休／有給） */
export function SubTabs({ items }: { items: { href: string; label: string; show?: boolean; also?: string[]; small?: boolean }[] }) {
  const path = usePathname();
  const list = items.filter((i) => i.show !== false);
  if (list.length < 2) return null;
  return (
    <nav className="tabs noprint" style={{ margin: "4px 0 12px" }}>
      {list.map((i) => <Link key={i.href} href={i.href} className={[i.href, ...(i.also ?? [])].some((h) => path === h || path.startsWith(h + "/")) ? "on" : ""} style={i.small ? { fontSize: 13 } : undefined}>{i.label}</Link>)}
    </nav>
  );
}
