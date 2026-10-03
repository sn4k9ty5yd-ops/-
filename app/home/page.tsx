"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import { LEVEL_NAMES } from "@/lib/permissions";

function Cards() {
  const { me, logout } = useMe();
  const router = useRouter();
  useEffect(() => { if (me.displayOnly) router.replace("/shifts"); }, [me.displayOnly, router]);   // お店のiPadは、すぐシフトの画面へ
  const [low, setLow] = useState(0);
  const [unread, setUnread] = useState(0);
  useEffect(() => { if (!me.displayOnly) api<{ unread: number }>("/api/notifications").then((r) => setUnread(r.unread)).catch(() => {}); }, [me.displayOnly]);
  useEffect(() => { if (me.level >= 2) api<{ count: number }>(`/api/stock?storeId=${me.storeId}&low=1`).then((r) => setLow(r.count)).catch(() => {}); }, [me.level, me.storeId]);
  if (me.displayOnly) return null;
  const cards = [
    { href: "/inbox", title: unread ? `お知らせ（${unread}件）` : "お知らせ", sub: unread ? "新しいお知らせがあります（休みのかぶりなど）" : "休みのかぶりや、話し合いの書き込み", show: true },
    { href: "/manual", title: "マニュアル", sub: "教育・営業マニュアル、技術動画、技術評価", show: true },
    { href: "/shifts", title: "シフトを見る", sub: "今日の出勤・月のシフト・みんなの休み", show: true },
    { href: "/material", title: "材料費（発注額）", sub: "発注した額を記録・月ごとの合計", show: true },
    { href: "/material/summary", title: "材料費統括", sub: "月ごと・お店ごと・商品ごとの割合（管理者・材料担当）", show: me.level === 4 || !!me.materialManager },
    { href: "/admin/attendance", title: "出勤簿", sub: "出勤・退勤・休憩・実働", show: me.level >= 3 },
    { href: "/admin/stock", title: "在庫", sub: low ? `少なくなっている商品が ${low} 件あります` : "いまの在庫・入庫と出庫・発注の目安", show: me.level >= 2 },
    { href: "/admin/stocktake", title: "棚卸し", sub: "店販・業務の棚卸し（印刷・コピーもできます）", show: me.level >= 2 },
    { href: "/admin/products", title: "商品一覧", sub: "店販・業務の商品と仕入値", show: me.level >= 3 },
    { href: "/admin/shifts", title: "シフトを作る", sub: "日ごと・人ごと・一覧表で入力します", show: me.level >= 2 },
    { href: "/requests", title: "希望休を出す", sub: "休みたい日をえらびます", show: true },
    { href: "/admin/requests", title: "みんなの希望休", sub: "スタッフの希望休を一覧で見ます", show: me.level >= 2 },
    { href: "/admin/periods", title: "シフト期間", sub: "受付・締切・確定・提出", show: me.level >= 3 },
    { href: "/admin/staff", title: "スタッフ", sub: "登録・退職・パスコード", show: me.level >= 3 },
    { href: "/admin/settings", title: "設定", sub: "休憩・実働のルール", show: me.level >= 4 },
    { href: "/admin/stores", title: "店舗の編集", sub: "新店舗の追加・名前の変更・閉店（管理者のみ）", show: me.level >= 4 },
  ].filter((c) => c.show);
  return (
    <main className="home">
      <p className="sub">株式会社ALBUM</p>
      <h1>{me.name} さん</h1>
      <p className="hint" style={{ marginTop: 0 }}>{LEVEL_NAMES[me.level]}</p>
      <div className="homegrid">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card-link"><b>{c.title}</b><span className="sub">{c.sub}</span></Link>
        ))}
      </div>
      <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={logout}>ログアウト</button>
    </main>
  );
}
export default function Home() { return <MeProvider><Cards /></MeProvider>; }
