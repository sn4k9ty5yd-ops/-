"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MeProvider, useMe } from "@/lib/client";
import { LEVEL_NAMES } from "@/lib/permissions";

const TABS = [
  { href: "/home", label: "ホーム" },
  { href: "/admin/requests", label: "希望休" },
  { href: "/admin/staff", label: "スタッフ" },
  { href: "/admin/stores", label: "お店" },
  { href: "/admin/periods", label: "シフト期間" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useMe();
  const path = usePathname();
  return (
    <div className="shell">
      <header className="demo">
        <span><b>株式会社ALBUM</b>　{me.name}（{LEVEL_NAMES[me.level]}）</span>
        <button className="ghost" style={{ color: "var(--ink)" }} onClick={logout}>ログアウト</button>
      </header>
      <nav className="tabs">
        {TABS.map((t) => <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.label}</Link>)}
      </nav>
      <main className="wide">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <MeProvider><Shell>{children}</Shell></MeProvider>;
}
