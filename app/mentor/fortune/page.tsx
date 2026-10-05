"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SubTabs } from "@/app/SubTabs";
import { api, MeProvider, useMe } from "@/lib/client";
import { compatibility, fortune, zodiacName, zodiacOf } from "@/lib/fortune";
import { MBTI_TYPES } from "@/lib/mentor";
import { mentorTabs } from "@/lib/mentor-tabs";
import { todayJst } from "@/lib/period-nav";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function Page() {
  const { me } = useMe();
  const [mbti, setMbti] = useState<string | null>(null);
  const [bd, setBd] = useState({ m: 0, d: 0 });
  const [other, setOther] = useState("");
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem("fortuneBirthday") ?? "null"); if (v?.m && v?.d) setBd(v); } catch { /* 保存がなくても動く */ }
    api<{ mbti: string | null }>("/api/mentor").then((r) => setMbti(r.mbti)).catch(() => {});
  }, []);
  const set = (b: { m: number; d: number }) => { setBd(b); try { localStorage.setItem("fortuneBirthday", JSON.stringify(b)); } catch { /* 無視 */ } };
  const z = bd.m && bd.d ? zodiacOf(bd.m, bd.d) : null;
  const f = z ? fortune(todayJst(), z, mbti) : null;
  const comp = mbti && other ? compatibility(mbti, other) : null;
  return (
    <main className="wide">
      <Link href="/home" className="back">← ホーム</Link>
      <h1>メンター</h1>
      <SubTabs items={mentorTabs(me.displayOnly, me.rank)} />
      <p className="sub">ちょっとした占いです。お楽しみで、気軽にどうぞ。毎日かわります。</p>
      <div className="card" style={{ marginBottom: 10 }}>
        <b>誕生日（星座を決めるために使います。この端末にだけ保存されます）</b>
        <div className="toolbar">
          <select aria-label="月" value={bd.m} onChange={(e) => set({ ...bd, m: Number(e.target.value) })}><option value={0}>月</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}月</option>)}</select>
          <select aria-label="日" value={bd.d} onChange={(e) => set({ ...bd, d: Number(e.target.value) })}><option value={0}>日</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}日</option>)}</select>
          {z && <span className="chip">{zodiacName(z)}</span>}
          {mbti && <span className="chip">{mbti}</span>}
        </div>
        {!mbti && <p className="sub" style={{ margin: "6px 0 0" }}>MBTIを入れると、結果がもっとあなたらしくなります（「チャット」で入れられます）。</p>}
      </div>
      {f ? (
        <div className="card">
          <div className="sub">今日の運勢</div>
          <div style={{ fontSize: 28, color: "#f5a623", letterSpacing: 2 }}>{stars(f.stars.total)}</div>
          <p style={{ fontSize: 18, fontWeight: 700 }}>{f.message}</p>
          <table className="tbl"><tbody>
            <tr><td>仕事運</td><td style={{ color: "#f5a623" }}>{stars(f.stars.work)}</td></tr>
            <tr><td>人間関係</td><td style={{ color: "#f5a623" }}>{stars(f.stars.people)}</td></tr>
            <tr><td>技術運</td><td style={{ color: "#f5a623" }}>{stars(f.stars.skill)}</td></tr>
          </tbody></table>
          <p>🎨 ラッキーカラー：<b>{f.luckyColor}</b>　🧰 ラッキーアイテム：<b>{f.luckyItem}</b>　🔢 ラッキーナンバー：<b>{f.luckyNumber}</b></p>
          <p className="sub">ひとこと：{f.advice}</p>
        </div>
      ) : <p className="hint">誕生日を入れると、今日の運勢が出ます。</p>}
      <div className="card" style={{ marginTop: 10 }}>
        <b>MBTIの相性</b>
        {!mbti ? <p className="sub">自分のMBTIを入れると、相性が見られます。</p> : (
          <>
            <select value={other} onChange={(e) => setOther(e.target.value)}><option value="">あいてのMBTIをえらぶ</option>{MBTI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            {comp && <p><b style={{ fontSize: 24 }}>{mbti} × {other}　{comp.score}%</b><br />{comp.comment}</p>}
          </>
        )}
      </div>
    </main>
  );
}
export default function FortunePage() { return <MeProvider><Page /></MeProvider>; }
