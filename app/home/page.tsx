"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, MeProvider, useMe } from "@/lib/client";
import { pushState, type PushState } from "@/lib/push-client";
import { LEVEL_NAMES } from "@/lib/permissions";
import { reiwa } from "@/lib/era";
import { todayJst } from "@/lib/period-nav";
import { WEEKDAYS } from "@/lib/labels";

function Cards() {
  const { me, logout } = useMe();
  const router = useRouter();
  useEffect(() => { if (me.displayOnly) router.replace("/shifts"); }, [me.displayOnly, router]);   // お店のiPadは、すぐシフトの画面へ
  const [unread, setUnread] = useState(0);
  const [leaveTodo, setLeaveTodo] = useState(0);
  useEffect(() => { if (me.level >= 3) api<{ todo: unknown[] }>("/api/paid-leave?review=1").then((r) => setLeaveTodo(r.todo.length)).catch(() => {}); }, [me.level]);
  const [push, setPush] = useState<PushState | null>(null);
  useEffect(() => { pushState().then(setPush).catch(() => {}); }, []);
  useEffect(() => { if (!me.displayOnly) api<{ unread: number }>("/api/notifications").then((r) => setUnread(r.unread)).catch(() => {}); }, [me.displayOnly]);
  if (me.displayOnly) return null;
  const cards = [
    { big: true, href: "/inbox", title: unread ? `お知らせ（${unread}件）` : "お知らせ", sub: unread ? "新しいお知らせがあります（休みのかぶりなど）" : "休みのかぶりや、話し合いの書き込み", show: true },
    { big: true, href: "/manual", title: "マニュアル", sub: "教育・営業マニュアル、技術動画、技術評価", show: true },
    { big: true, href: "/shifts", title: leaveTodo ? `シフト（有給の確認待ち${leaveTodo}件）` : "シフト", sub: me.level >= 2 ? "見る・希望休・有給・次のシフトを作る・出勤簿" : "シフトを見る・希望休を出す・有給の提出と変更", show: true },
    { big: true, href: "/material", title: "材料費（発注額）", sub: "発注した額を記録・月ごとの合計", show: true },
    { href: "/material/summary", title: "材料費統括", sub: "月ごと・お店ごと・商品ごとの割合（管理者・材料担当）", show: me.level === 4 || !!me.materialManager },
    { big: true, href: "/my-lessons", title: "自分のレッスン", sub: "何をしたか・何人目か・かかった時間をカレンダーで見る", show: me.rank === "assistant" },
    { href: "/lessons", title: "レッスン記録", sub: "アシスタントが今日何をしたかを、ボタンで記録・報告", show: me.level >= 3 || !!me.eduLead },
    { href: "/admin/stocktake", title: "棚卸し", sub: "店販・業務の棚卸し（印刷・コピーもできます）", show: me.level >= 2 },
    { href: "/admin/products", title: "商品一覧", sub: "店販・業務の商品と仕入値", show: me.level >= 3 },
    { href: "/admin/shifts", title: "出勤簿", sub: "日ごと・人ごと・一覧表で入力します", show: false },
    { big: true, href: me.level === 4 ? "/sales" : "/my-sales", title: "売上", sub: me.level >= 2 ? "自分の売上の提出・みんなの確認・歩合・目標" : "売上・客単価・前年比・目標・店内ランキング", show: !me.displayOnly },
    { href: "/admin/requests", title: "シフト", sub: "みんなの休みをカレンダーで見る", show: false },
    { href: "/admin/periods", title: "シフト期間", sub: "受付・締切・確定・提出", show: false },
    { href: "/admin/staff", title: "スタッフ", sub: "登録・退職・パスコード", show: me.level >= 3 },
    { href: "/security", title: "セキュリティ", sub: "パスコードを変える・ログインの記録", show: true },
    { href: "/admin/records", title: "税務署用の書面", sub: "全情報を、期間をえらんで書面（印刷・PDF）にする", show: me.level === 4 },
    { big: true, href: "/help", title: "ヘルプ", sub: "このアプリでできることと、やり方・ご要望を送る", show: true },
    { href: "/admin/feedback", title: "届いたご要望", sub: "みんなからの「こうしてほしい」（制作者だけ）", show: !!me.appOwner },
    { href: "/admin/guide", title: "アプリの説明書", sub: "社長用・事務員さん用・全社員Zoom台本（印刷・コピー）", show: !!me.appOwner },
    { href: "/admin/settings", title: "設定", sub: "休憩・実働のルール", show: me.level >= 4 },
    { href: "/admin/stores", title: "店舗の編集", sub: "新店舗の追加・名前の変更・閉店（管理者のみ）", show: me.level >= 4 },
  ].filter((c) => c.show);
  const ICON: Record<string, [string, number, string]> = {
    "/inbox": ["🔔", 8, ""], "/manual": ["📖", 265, ""], "/shifts": ["📅", 212, ""], "/requests": ["🌴", 168, ""], "/material": ["🧴", 28, ""],
    "/material/summary": ["📊", 28, "材料・在庫"], "/my-lessons": ["🎓", 262, ""], "/leave": ["🏝️", 172, ""], "/my-sales": ["📈", 140, ""], "/sales": ["💴", 140, "シフト・勤怠"], "/lessons": ["🎓", 262, "スタッフ・設定"], "/admin/stock": ["📦", 150, "材料・在庫"], "/admin/stocktake": ["📋", 190, "材料・在庫"], "/admin/products": ["🏷️", 320, "材料・在庫"],
    "/admin/periods": ["🗂️", 212, "シフト・勤怠"], "/admin/shifts": ["✏️", 212, "シフト・勤怠"], "/admin/requests": ["👥", 168, "シフト・勤怠"], 
    "/admin/staff": ["🧑‍🤝‍🧑", 340, "スタッフ・設定"], "/admin/settings": ["⚙️", 220, "スタッフ・設定"], "/security": ["🔐", 8, "スタッフ・設定"], "/admin/records": ["🧾", 45, "スタッフ・設定"], "/admin/guide": ["📘", 205, "スタッフ・設定"], "/help": ["❓", 200, ""], "/admin/feedback": ["💌", 330, "スタッフ・設定"], "/admin/stores": ["🏬", 280, "スタッフ・設定"],
  };
  const ic = (href: string) => ICON[href] ?? ["•", 210, ""];
  const big = cards.filter((c) => c.big), rest = cards.filter((c) => !c.big);
  const groups = ["シフト・勤怠", "材料・在庫", "スタッフ・設定"].map((g) => [g, rest.filter((c) => ic(c.href)[2] === g)] as const).filter(([, l]) => l.length > 0);
  const today = todayJst();
  const hello = `${reiwa(today)}（${WEEKDAYS[new Date(today + "T00:00:00Z").getUTCDay()]}）`;
  const Icon = ({ href }: { href: string }) => <span className="ic" style={{ ["--h" as string]: ic(href)[1] }} aria-hidden>{ic(href)[0]}</span>;
  return (
    <main className="home">
      <p className="eyebrow">{hello}</p>
      <h1 className="hero">{me.name}</h1>
      <p className="role">{LEVEL_NAMES[me.level]}{me.appOwner ? "・アプリ制作者" : ""}　·　株式会社ALBUM</p>
      {push && push !== "on" && push !== "unsupported" && !me.displayOnly && (
        <Link href="/notify" className="pushbanner"><span className="ic" style={{ ["--h" as string]: 8 }} aria-hidden>📣</span><span><b>スマホに通知を届けましょう（1分）</b><small>シフトの公開や、毎朝の「今日の出勤メンバー」が届きます。やり方を絵で案内します。</small></span><i>›</i></Link>
      )}
      <div className="tiles">
        {big.map((c) => (
          <Link key={c.href} href={c.href} className="tile" style={{ ["--h" as string]: ic(c.href)[1] }}><Icon href={c.href} /><b>{c.title}</b><span>{c.sub}</span></Link>
        ))}
      </div>
      {groups.map(([g, list]) => (
        <section key={g}>
          <h2 className="grouphead">{g}</h2>
          <div className="rows">
            {list.map((c) => (
              <Link key={c.href} href={c.href} className="row"><Icon href={c.href} /><span className="rt"><b>{c.title}</b><small>{c.sub}</small></span><i>›</i></Link>
            ))}
          </div>
        </section>
      ))}
      <button className="logout" onClick={logout}>ログアウト</button>
    </main>
  );
}
export default function Home() { return <MeProvider><Cards /></MeProvider>; }
