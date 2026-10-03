"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import { LEVEL_NAMES } from "@/lib/permissions";

function Cards() {
  const { me, logout } = useMe();
  const [leave, setLeave] = useState<{ remaining: number } | null>(null);
  useEffect(() => { api<{ remaining: number } | null>("/api/leave?me=1").then(setLeave).catch(() => {}); }, []);
  const cards = [
    { href: "/shifts", title: "シフトを見る", sub: "今日の出勤・月のシフト・みんなの休み", show: true },
    { href: "/admin/attendance", title: "出勤簿", sub: "出勤・退勤・休憩・実働、有給の残り", show: me.level >= 3 },
    { href: "/admin/stocktake", title: "棚卸し", sub: "店販・業務の棚卸し（印刷・コピーもできます）", show: me.level >= 2 },
    { href: "/admin/products", title: "商品一覧", sub: "店販・業務の商品と仕入値", show: me.level >= 3 },
    { href: "/admin/shifts", title: "シフトを作る", sub: "日ごと・人ごと・一覧表で入力します", show: me.level >= 2 },
    { href: "/requests", title: "希望休を出す", sub: "休みたい日をえらびます", show: true },
    { href: "/admin/requests", title: "みんなの希望休", sub: "スタッフの希望休を一覧で見ます", show: me.level >= 2 },
    { href: "/admin/periods", title: "シフト期間", sub: "受付・締切・確定・提出", show: me.level >= 3 },
    { href: "/admin/staff", title: "スタッフ", sub: "登録・退職・パスコード", show: me.level >= 3 },
    { href: "/admin/settings", title: "設定", sub: "休憩・実働のルール", show: me.level >= 4 },
    { href: "/admin/stores", title: "お店", sub: "お店の一覧と追加", show: me.level >= 3 },
  ].filter((c) => c.show);
  return (
    <main>
      <p className="sub">株式会社ALBUM</p>
      <h1>{me.name} さん</h1>
      <p className="hint" style={{ marginTop: -16 }}>{LEVEL_NAMES[me.level]}</p>
      {leave && <div className="card"><span className="sub">有給の残り日数</span><div className="big">{leave.remaining}<span style={{ fontSize: 16 }}> 日</span></div></div>}
      {cards.map((c) => (
        <Link key={c.href} href={c.href} className="card-link"><b>{c.title}</b><span className="sub">{c.sub}</span></Link>
      ))}
      <button className="ghost" style={{ color: "var(--ink)", width: "100%" }} onClick={logout}>ログアウト</button>
    </main>
  );
}
export default function Home() { return <MeProvider><Cards /></MeProvider>; }
