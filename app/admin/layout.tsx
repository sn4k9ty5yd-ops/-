"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MeProvider, useMe } from "@/lib/client";
import { levelLabel } from "@/lib/permissions";
import { SubTabs } from "@/app/SubTabs";
import { shiftTabs } from "@/lib/shift-tabs";

// 画面ごとに必要な操作レベル（データの権限はDB側でも守られている。ここは見た目のため）
const TABS: { href: string; label: string; min: number; sub?: boolean; owner?: boolean }[] = [
  { href: "/home", label: "ホーム", min: 1 },
  { href: "/shifts", label: "シフト", min: 1 },
  { href: "/admin/periods", label: "進み具合・締切", min: 2, sub: true },
  { href: "/admin/shifts", label: "出勤簿", min: 2, sub: true },
  { href: "/admin/staff", label: "スタッフ", min: 3 },
  { href: "/admin/stocktake", label: "棚卸し", min: 1 },
  { href: "/admin/products", label: "商品", min: 3 },
  { href: "/admin/stores", label: "店舗の編集", min: 4 },
  { href: "/admin/settings", label: "設定", min: 3 },
  { href: "/admin/records", label: "税務署用の書面", min: 4 },
  { href: "/admin/guide", label: "説明書", min: 4, owner: true },
  { href: "/admin/feedback", label: "ご要望", min: 4, owner: true },
  { href: "/admin/activity", label: "変更の記録", min: 4, owner: true },
];

const SHIFT_PATHS = ["/admin/shift", "/admin/periods"];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useMe();
  const path = usePathname();
  const need = [...TABS].sort((a, b) => b.href.length - a.href.length).find((t) => path.startsWith(t.href) && t.href !== "/home")?.min ?? 1;
  const needOwner = TABS.find((t) => path.startsWith(t.href) && t.owner);
  const allowed = me.level >= need && (!needOwner || !!me.appOwner);
  const inShift = SHIFT_PATHS.some((h) => path.startsWith(h));
  return (
    <div className="shell">
      <header className="demo">
        <span><b>株式会社ALBUM</b>　{me.name}（{levelLabel(me, me)}）</span>
        <span className="actions">
          {me.level === 4 && <Link href="/admin/stores" className="storelink">⚙ 店舗の編集</Link>}
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={logout}>ログアウト</button>
        </span>
      </header>
      <nav className="tabs">
        {TABS.filter((t) => me.level >= t.min && (!t.owner || me.appOwner) && !t.sub).map((t) => <Link key={t.href} href={t.href} className={path === t.href || (t.href === "/shifts" && inShift) ? "on" : ""}>{t.label}</Link>)}
      </nav>
      {inShift && <div className="wide" style={{ paddingBottom: 0 }}><SubTabs items={shiftTabs(me.level)} /></div>}
      <main className={path.startsWith("/admin/shifts") || path.startsWith("/admin/stocktake") || path.startsWith("/admin/stock") || path.startsWith("/admin/products") || path.startsWith("/admin/records") ? "xwide" : "wide"}>{allowed ? children : <p className="hint">この画面を使う権限がありません。<Link href="/home">ホームへ戻る</Link></p>}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <MeProvider><Shell>{children}</Shell></MeProvider>;
}
