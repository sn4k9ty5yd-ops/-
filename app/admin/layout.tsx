"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MeProvider, useMe } from "@/lib/client";
import { LEVEL_NAMES } from "@/lib/permissions";

// 画面ごとに必要な操作レベル（データの権限はDB側でも守られている。ここは見た目のため）
const TABS: { href: string; label: string; min: number; sub?: boolean; owner?: boolean }[] = [
  { href: "/home", label: "ホーム", min: 1 },
  { href: "/admin/shift", label: "シフト", min: 2 },
  { href: "/admin/shifts", label: "出勤簿", min: 2, sub: true },
  { href: "/admin/attendance", label: "勤務時間の提出", min: 2, sub: true },
  { href: "/admin/requests", label: "みんなの希望休", min: 2, sub: true },
  { href: "/requests", label: "自分の希望休を出す", min: 2, sub: true },
  { href: "/admin/staff", label: "スタッフ", min: 3 },
  { href: "/admin/stock", label: "在庫", min: 2 },
  { href: "/admin/stocktake", label: "棚卸し", min: 2 },
  { href: "/admin/products", label: "商品", min: 3 },
  { href: "/admin/stores", label: "店舗の編集", min: 4 },
  { href: "/admin/periods", label: "シフト期間", min: 2, sub: true },
  { href: "/admin/settings", label: "設定", min: 3 },
  { href: "/admin/notices", label: "お知らせ文", min: 4 },
  { href: "/admin/records", label: "税務署用の書面", min: 4 },
  { href: "/admin/guide", label: "説明書", min: 4, owner: true },
  { href: "/admin/feedback", label: "ご要望", min: 4, owner: true },
];

const SHIFT_PATHS = ["/admin/shift", "/admin/attendance", "/admin/requests", "/admin/periods", "/requests"];

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
        <span><b>株式会社ALBUM</b>　{me.name}（{LEVEL_NAMES[me.level]}）</span>
        <span className="actions">
          {me.level === 4 && <Link href="/admin/stores" className="storelink">⚙ 店舗の編集</Link>}
          <button className="ghost" style={{ color: "var(--ink)" }} onClick={logout}>ログアウト</button>
        </span>
      </header>
      <nav className="tabs">
        {TABS.filter((t) => me.level >= t.min && (!t.owner || me.appOwner) && (!t.sub || inShift)).map((t) => <Link key={t.href} href={t.href} className={path === t.href || (t.href === "/admin/shift" && path === "/admin/shift") ? "on" : ""}>{t.label}</Link>)}
      </nav>
      <main className={path.startsWith("/admin/shifts") || path.startsWith("/admin/attendance") || path.startsWith("/admin/stocktake") || path.startsWith("/admin/stock") || path.startsWith("/admin/products") || path.startsWith("/admin/requests") || path.startsWith("/admin/records") ? "xwide" : "wide"}>{allowed ? children : <p className="hint">この画面を使う権限がありません。<Link href="/home">ホームへ戻る</Link></p>}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <MeProvider><Shell>{children}</Shell></MeProvider>;
}
