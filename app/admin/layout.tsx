"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MeProvider, useMe } from "@/lib/client";
import { LEVEL_NAMES } from "@/lib/permissions";

// 画面ごとに必要な操作レベル（データの権限はDB側でも守られている。ここは見た目のため）
const TABS = [
  { href: "/home", label: "ホーム", min: 1 },
  { href: "/admin/shifts", label: "シフト作成", min: 2 },
  { href: "/admin/attendance", label: "出勤簿", min: 3 },
  { href: "/admin/requests", label: "希望休", min: 2 },
  { href: "/admin/staff", label: "スタッフ", min: 3 },
  { href: "/admin/stores", label: "お店", min: 3 },
  { href: "/admin/periods", label: "シフト期間", min: 3 },
  { href: "/admin/settings", label: "設定", min: 3 },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useMe();
  const path = usePathname();
  const need = TABS.find((t) => path.startsWith(t.href) && t.href !== "/home")?.min ?? 1;
  const allowed = me.level >= need;
  return (
    <div className="shell">
      <header className="demo">
        <span><b>株式会社ALBUM</b>　{me.name}（{LEVEL_NAMES[me.level]}）</span>
        <button className="ghost" style={{ color: "var(--ink)" }} onClick={logout}>ログアウト</button>
      </header>
      <nav className="tabs">
        {TABS.filter((t) => me.level >= t.min).map((t) => <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.label}</Link>)}
      </nav>
      <main className={path.startsWith("/admin/shifts") || path.startsWith("/admin/attendance") || path.startsWith("/admin/requests") ? "xwide" : "wide"}>{allowed ? children : <p className="hint">この画面を使う権限がありません。<Link href="/home">ホームへ戻る</Link></p>}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <MeProvider><Shell>{children}</Shell></MeProvider>;
}
