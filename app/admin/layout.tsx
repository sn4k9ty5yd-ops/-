"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppProvider, useApp } from "@/lib/store";
import { LEVEL_NAMES } from "@/lib/permissions";

const TABS = [
  { href: "/admin/staff", label: "スタッフ" },
  { href: "/admin/stores", label: "お店" },
  { href: "/admin/periods", label: "シフト期間" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, allUsers, switchUser } = useApp();
  const path = usePathname();
  return (
    <div className="shell">
      <header className="demo">
        <b>デモ表示</b>（データはこの端末だけに保存されます）
        <label>
          ログイン中の人：
          <select value={me.id} onChange={(e) => switchUser(e.target.value)}>
            {allUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {LEVEL_NAMES[u.level]}</option>
            ))}
          </select>
        </label>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.label}</Link>
        ))}
      </nav>
      <main className="wide">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
