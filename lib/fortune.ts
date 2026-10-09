/** 占い（お楽しみ）。誕生日の星座＋MBTI＋その日の日付から、毎日かわる運勢をつくる（同じ人・同じ日は、いつも同じ結果）。AIは使わない（無料） */
export const ZODIAC: { id: string; name: string; from: [number, number] }[] = [
  { id: "capricorn", name: "やぎ座", from: [12, 22] }, { id: "aquarius", name: "みずがめ座", from: [1, 20] }, { id: "pisces", name: "うお座", from: [2, 19] },
  { id: "aries", name: "おひつじ座", from: [3, 21] }, { id: "taurus", name: "おうし座", from: [4, 20] }, { id: "gemini", name: "ふたご座", from: [5, 21] },
  { id: "cancer", name: "かに座", from: [6, 22] }, { id: "leo", name: "しし座", from: [7, 23] }, { id: "virgo", name: "おとめ座", from: [8, 23] },
  { id: "libra", name: "てんびん座", from: [9, 23] }, { id: "scorpio", name: "さそり座", from: [10, 24] }, { id: "sagittarius", name: "いて座", from: [11, 23] },
];
export function zodiacOf(month: number, day: number): string {
  let cur = ZODIAC[0];   // やぎ座は 12/22〜1/19
  for (const z of ZODIAC) if (month > z.from[0] || (month === z.from[0] && day >= z.from[1])) cur = z;
  if (month === 12 && day >= 22) return "capricorn";
  if (month === 1 && day < 20) return "capricorn";
  return cur.id;
}
export const zodiacName = (id: string) => ZODIAC.find((z) => z.id === id)?.name ?? "";

/** 文字から、同じなら同じ数をつくる（FNV-1a） */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = <T,>(arr: readonly T[], h: number) => arr[h % arr.length];
const COLORS = ["あか", "あお", "きいろ", "みどり", "ピンク", "むらさき", "オレンジ", "しろ", "くろ", "ゴールド", "ミントグリーン", "ネイビー"] as const;
const ITEMS = ["コーム", "ハサミ", "ミラー", "ハンドクリーム", "香りのいいシャンプー", "メモ帳", "ペン", "ヘアオイル", "ヘアゴム", "お気に入りのタオル", "ミント系のガム", "リップ", "ピアス・イヤリング", "香水・ヘアミスト", "ヘアクリップ", "ネイル", "ブラシ", "ハンドミラー"] as const;
const MESSAGES = [
  "いつもより、ひとこと多く声をかけると、いい流れがくる日。", "ゆっくり深呼吸。あわてず、ひとつずつ片づけると、うまくいく日。", "ちょっとした気づきが、お客様に喜ばれる日。",
  "ほめ言葉を、素直に受け取ると運気アップ。", "苦手だと思っていたことに、さらっと挑戦してみて。", "仲間の「ありがとう」が、いつもより多く聞ける日。",
  "今日の頑張りは、あとから、じわじわ効いてくる。", "いつもの道具を、いつもより丁寧に扱うと、いいことが。", "笑顔が、いちばんの技術になる日。",
  "迷ったら、直感を信じて大丈夫。", "ひとりで抱えこまず、まわりに頼ってOK。", "終わったあとのごほうびを、先に決めておくと元気が出る日。",
] as const;
const ADVICE = [
  "あいさつは、いつもより少し大きな声で。", "お昼は、しっかり食べてエネルギー補給。", "帰る前に、明日の準備をひとつだけ。", "お客様の名前を、会話でひとつ多く呼んでみて。",
  "片づけを、いつもよりきれいに。", "同期や後輩に、ひとことねぎらいを。", "鏡の前で、笑顔の練習を10秒。", "スマホを見る時間を、少しだけ減らしてみて。",
] as const;

export interface Fortune { stars: { total: number; work: number; people: number; skill: number }; luckyColor: string; luckyItem: string; message: string; advice: string; luckyNumber: number }
export function fortune(day: string, zodiac: string, mbti: string | null): Fortune {
  const base = `${day}|${zodiac}|${mbti ?? ""}`;
  const star = (k: string) => 1 + (hash(`${base}|${k}`) % 5);
  const s = { work: star("work"), people: star("people"), skill: star("skill") };
  const total = Math.max(1, Math.min(5, Math.round((s.work + s.people + s.skill) / 3)));
  return {
    stars: { total, ...s },
    luckyColor: pick(COLORS, hash(`${base}|color`)), luckyItem: pick(ITEMS, hash(`${base}|item`)),
    message: pick(MESSAGES, hash(`${base}|msg`)), advice: pick(ADVICE, hash(`${base}|adv`)), luckyNumber: 1 + (hash(`${base}|num`) % 9),
  };
}

/** 美容師としてのひとこと（お客様・技術・身だしなみ）。その日のうらないに添える */
const PRO = [
  "お客様の髪に触れる前の「失礼します」のひとこと。信頼は、そこから始まります。",
  "仕上げのブロー、最後の10秒を丁寧に。お客様の帰り道の笑顔が変わる日。",
  "お客様の服やバッグの色をさりげなく見て、似合う髪色をひとつ提案してみて。",
  "カウンセリングで「普段どうセットしてますか？」をひとつ多く聞くと、仕上がりがピタッと決まる日。",
  "後ろ姿まで鏡で見せてあげて。美容師の、いちばんの見せ場です。",
  "ハサミとコームを、いつもより丁寧に手入れすると、運気が上がる日。",
  "気になるスタイルの写真を1枚だけ保存してみて。ひらめきが、明日のご提案になります。",
  "「最近この色が人気ですよ」とトレンドをひとつ話題に。お客様の心に刺さる日。",
  "自分の髪も看板。ツヤと毛先を整えて立つと、お客様の目が変わります。",
  "お客様の「ありがとう」の言い方に耳をすませて。次の提案のヒントが隠れています。",
  "前髪の長さと顔まわりを、いつもより丁寧に見立てる日。ここで印象が決まります。",
  "施術のあとに「おうちでのお手入れ」をひとこと添えると、次のご来店につながります。",
  "待ち時間のお客様に、ひとこと声をかけてみて。安心が、いちばんのサービスです。",
  "仲間のスタイルをほめてみて。自分の目も、センスも、育つ日。",
  "お客様の髪質を、手で触れて確かめる時間を少し長めに。提案の説得力が増します。",
  "鏡に映る自分の姿勢をチェック。立ち姿の美しさも、美容師の技術です。",
] as const;
/** おしゃれのひとこと（ラッキーカラーを、身につけるものに取り入れる） */
const SPOTS = ["ネイル", "ヘアアクセ", "ピアス・イヤリング", "靴下やインナー", "エプロンまわり", "時計やブレスレット", "小物（ペンやポーチ）", "リップやチーク"] as const;
const STYLE = [
  "美容師は動く看板。今日の{c}を{s}にひとつ足すと、おしゃれ度アップ。",
  "{s}に{c}をさし色で。小さな変化に気づくお客様が、きっといます。",
  "いつもの服に、{c}を{s}でひとさじ。会話のきっかけにもなります。",
  "今日は{c}がラッキー。{s}で取り入れて、鏡の前で気分を上げてから出勤を。",
] as const;
export function beautyFortune(day: string, zodiac: string, mbti: string | null, luckyColor: string): { pro: string; style: string } {
  const base = `${day}|${zodiac}|${mbti ?? ""}`;
  return {
    pro: pick(PRO, hash(`${base}|pro`)),
    style: pick(STYLE, hash(`${base}|style`)).replace("{c}", luckyColor).replace("{s}", pick(SPOTS, hash(`${base}|spot`))),
  };
}

/** 毎朝の通知に出す文章（題名と本文） */
export function fortunePushText(day: string, zodiac: string, mbti: string | null): { title: string; body: string } {
  const f = fortune(day, zodiac, mbti), b = beautyFortune(day, zodiac, mbti, f.luckyColor);
  return {
    title: `🔮 今日の運勢 ${"★".repeat(f.stars.total)}${"☆".repeat(5 - f.stars.total)}`,
    body: `${f.message}\n🎨 ラッキーカラー：${f.luckyColor}　🧰 ラッキーアイテム：${f.luckyItem}\n💇 美容師として：${b.pro}\n👗 おしゃれ：${b.style}`,
  };
}

/** 2人のMBTIの相性（お楽しみ）。0〜100 */
export function compatibility(a: string, b: string): { score: number; comment: string } {
  const [x, y] = [a, b].sort();
  let score = 50 + (hash(`${x}-${y}`) % 31);                         // 50〜80
  const same = [0, 1, 2, 3].filter((i) => a[i] === b[i]).length;
  if (a[1] !== b[1]) score += 6;                                      // 見るところ（N/S）がちがうと、補いあえる
  if (a[2] === b[2]) score += 4;
  if (a === b) score = Math.max(score, 78);
  score = Math.min(99, score + same);
  const comment = score >= 85 ? "ツーカーの名コンビ！言わなくても通じるところが多いはず。" : score >= 70 ? "いい相性。お互いの得意を、うまく分けあえそう。" : score >= 58 ? "ふつうに仲よし。ちがいを面白がると、もっと近づくよ。" : "ちがいが多いぶん、学びも多い組み合わせ。ゆっくり話すのがコツ。";
  return { score, comment };
}
