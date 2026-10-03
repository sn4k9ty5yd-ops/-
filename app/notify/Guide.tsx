"use client";
/** 「ホーム画面に追加」→「通知をオンにする」までの、絵つきの案内（iPhone／Android） */
import type { ReactNode } from "react";

const W = 168, H = 330;
function Phone({ children, ring }: { children: ReactNode; ring?: { x: number; y: number; w: number; h: number; r?: number } }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ maxWidth: 190 }}>
      <rect x="2" y="2" width={W - 4} height={H - 4} rx="26" fill="#1d1d1f" />
      <rect x="9" y="9" width={W - 18} height={H - 18} rx="20" fill="#fff" />
      <rect x={W / 2 - 24} y="13" width="48" height="10" rx="5" fill="#1d1d1f" />
      {children}
      {ring && <rect x={ring.x} y={ring.y} width={ring.w} height={ring.h} rx={ring.r ?? 10} fill="none" stroke="#ff3b30" strokeWidth="3.5"><animate attributeName="stroke-opacity" values="1;.25;1" dur="1.4s" repeatCount="indefinite" /></rect>}
    </svg>
  );
}
const T = ({ x, y, s = 9, c = "#1d1d1f", w = 400, a = "start", children }: { x: number; y: number; s?: number; c?: string; w?: number; a?: "start" | "middle" | "end"; children: ReactNode }) =>
  <text x={x} y={y} fontSize={s} fill={c} fontWeight={w} textAnchor={a} fontFamily="-apple-system,'Hiragino Sans',sans-serif">{children}</text>;
const Bar = ({ y, w = 120, c = "#e5e5ea" }: { y: number; w?: number; c?: string }) => <rect x="24" y={y} width={w} height="8" rx="4" fill={c} />;

const Page = () => (<>
  <rect x="9" y="30" width={W - 18} height="52" fill="#0071e3" opacity=".12" />
  <T x={W / 2} y={62} s={15} w={700} a="middle" c="#0071e3">ALBUM</T>
  <Bar y={100} /><Bar y={116} w={90} /><Bar y={132} w={110} />
</>);

type SceneId = "i-share" | "i-add-menu" | "i-add" | "home" | "enable" | "a-menu" | "a-add";
function Scene({ id }: { id: SceneId }) {
  switch (id) {
    case "i-share": return (
      <Phone ring={{ x: 60, y: 284, w: 48, h: 30, r: 15 }}>
        <Page />
        <rect x="9" y="272" width={W - 18} height="49" fill="#f2f2f7" />
        <T x={W / 2} y={290} s={7} c="#6e6e73" a="middle">album-system.onrender.com</T>
        <g transform="translate(76 296)" fill="none" stroke="#0071e3" strokeWidth="2" strokeLinecap="round"><path d="M8 11V1M4 5l4-4 4 4" /><path d="M2 8v9h12V8" /></g>
      </Phone>);
    case "i-add-menu": return (
      <Phone ring={{ x: 16, y: 178, w: 136, h: 32 }}>
        <Page />
        <rect x="9" y="120" width={W - 18} height="201" rx="14" fill="#f2f2f7" />
        <rect x="16" y="130" width="136" height="32" rx="8" fill="#fff" /><T x={26} y={150} s={9}>コピー</T>
        <rect x="16" y="166" width="136" height="0" />
        <rect x="16" y="178" width="136" height="32" rx="8" fill="#fff" /><T x={26} y={198} s={9} w={700}>ホーム画面に追加　＋</T>
        <rect x="16" y="214" width="136" height="32" rx="8" fill="#fff" /><T x={26} y={234} s={9}>ブックマークを追加</T>
      </Phone>);
    case "i-add": return (
      <Phone ring={{ x: 112, y: 30, w: 44, h: 22, r: 11 }}>
        <rect x="9" y="26" width={W - 18} height="30" fill="#f2f2f7" />
        <T x={18} y={45} s={7} c="#0071e3">取消</T><T x={W / 2 - 4} y={45} s={8} w={700} a="middle">ホーム画面に追加</T><T x={134} y={45} s={9} c="#0071e3" w={700} a="middle">追加</T>
        <rect x="24" y="78" width="44" height="44" rx="11" fill="#0071e3" /><T x={46} y={107} s={12} c="#fff" w={700} a="middle">A</T>
        <T x={78} y={96} s={10} w={700}>ALBUM</T><T x={78} y={112} s={7} c="#6e6e73">album-system…</T>
      </Phone>);
    case "home": return (
      <Phone ring={{ x: 26, y: 70, w: 48, h: 62 }}>
        <rect x="9" y="9" width={W - 18} height={H - 18} rx="20" fill="#5ac8fa" opacity=".35" />
        <rect x="30" y="74" width="40" height="40" rx="10" fill="#0071e3" /><T x={50} y={100} s={13} c="#fff" w={700} a="middle">A</T><T x={50} y={127} s={8} a="middle">ALBUM</T>
        <rect x="88" y="74" width="40" height="40" rx="10" fill="#fff" opacity=".7" /><rect x="30" y="150" width="40" height="40" rx="10" fill="#fff" opacity=".7" /><rect x="88" y="150" width="40" height="40" rx="10" fill="#fff" opacity=".7" />
      </Phone>);
    case "enable": return (
      <Phone ring={{ x: 78, y: 214, w: 62, h: 28 }}>
        <rect x="9" y="30" width={W - 18} height="40" fill="#0071e3" opacity=".1" /><T x={W / 2} y={55} s={11} w={700} a="middle">ALBUM</T>
        <rect x="22" y="84" width="124" height="34" rx="17" fill="#0071e3" /><T x={W / 2} y={105} s={10} c="#fff" w={700} a="middle">通知をオンにする</T>
        <rect x="14" y="150" width="140" height="100" rx="14" fill="#f2f2f7" stroke="#d2d2d7" />
        <T x={W / 2} y={172} s={8.5} w={700} a="middle">通知を送信します。</T><T x={W / 2} y={186} s={8.5} w={700} a="middle">よろしいですか？</T>
        <rect x="20" y="214" width="56" height="28" rx="8" fill="#e5e5ea" /><T x={48} y={232} s={9} a="middle">許可しない</T>
        <rect x="84" y="214" width="56" height="28" rx="8" fill="#0071e3" /><T x={112} y={232} s={9} c="#fff" w={700} a="middle">許可</T>
      </Phone>);
    case "a-menu": return (
      <Phone ring={{ x: 128, y: 28, w: 26, h: 26, r: 13 }}>
        <rect x="9" y="26" width={W - 18} height="32" fill="#f2f2f7" /><T x={20} y={46} s={8} c="#6e6e73">album-system.onrender.com</T>
        {[0, 1, 2].map((i) => <circle key={i} cx="141" cy={35 + i * 7} r="2.2" fill="#1d1d1f" />)}
        <Page />
      </Phone>);
    case "a-add": return (
      <Phone ring={{ x: 44, y: 128, w: 114, h: 28 }}>
        <Page />
        <rect x="40" y="60" width="122" height="190" rx="10" fill="#fff" stroke="#d2d2d7" />
        <T x={50} y={82} s={8.5}>新しいタブ</T><T x={50} y={104} s={8.5}>履歴</T>
        <T x={50} y={146} s={8.5} w={700}>ホーム画面に追加</T><T x={50} y={168} s={8.5}>デスクトップ版サイト</T>
      </Phone>);
  }
}

const IOS: { id: SceneId; t: string; d: string }[] = [
  { id: "i-share", t: "Safari（青いコンパスのアプリ）で開く", d: "かならず Safari で開きます（LINEやGoogleアプリの中では、うまくいきません）。画面の下の「共有」ボタン（四角から矢印が出ているマーク）を押します。" },
  { id: "i-add-menu", t: "「ホーム画面に追加」を選ぶ", d: "出てきた一覧を、少し上にスクロールすると「ホーム画面に追加」があります。" },
  { id: "i-add", t: "右上の「追加」を押す", d: "名前は「ALBUM」のままで大丈夫です。" },
  { id: "home", t: "ホーム画面の「ALBUM」から開く", d: "これからは、このアイコンから開きます。ここがいちばん大事です。Safariからではなく、このアイコンから開いてください。" },
  { id: "enable", t: "「通知をオンにする」→「許可」", d: "アプリのホーム画面にある「通知をオンにする」を押します。「通知を送信します」と聞かれたら「許可」を押します。" },
];
const ANDROID: { id: SceneId; t: string; d: string }[] = [
  { id: "a-menu", t: "Chromeで開いて、右上の「⋮」を押す", d: "Chrome（赤・黄・緑・青のアプリ）で開きます。右上の点が3つ並んだマークを押します。" },
  { id: "a-add", t: "「ホーム画面に追加」を選ぶ", d: "「アプリをインストール」と出ることもあります。どちらでも同じです。「追加」または「インストール」を押します。" },
  { id: "home", t: "ホーム画面の「ALBUM」から開く", d: "これからは、このアイコンから開きます。" },
  { id: "enable", t: "「通知をオンにする」→「許可」", d: "アプリのホーム画面にある「通知をオンにする」を押します。「通知を送信しますか？」と聞かれたら「許可」を押します。" },
];

export default function Guide({ kind }: { kind: "ios" | "android" }) {
  const steps = kind === "ios" ? IOS : ANDROID;
  return (
    <div className="guide">
      {steps.map((s, i) => (
        <div key={i} className="gstep">
          <Scene id={s.id} />
          <div><span className="gnum">{i + 1}</span><b>{s.t}</b><p className="sub">{s.d}</p></div>
        </div>
      ))}
    </div>
  );
}
