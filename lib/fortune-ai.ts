/** くわしい占い（AI）。指示文は、ユーザーが決めた文章のまま。生年月日などを前に付けて、AIに送る。 */
export type FortuneKind = "shichu" | "rokusei" | "animal";

export const FORTUNE_KINDS: { id: FortuneKind; icon: string; title: string; lead: string; needTime: boolean; prompt: string }[] = [
  {
    id: "shichu", icon: "🀄", title: "四柱推命", lead: "生年月日・出生時間・出生地から、命式（生まれ持った運の地図）を出して、くわしく読みます", needTime: true,
    prompt: `あなたは四柱推命の専門家です。
私の生年月日・出生時間・出生地をもとに、命式を正確に出してください。

そのうえで、
・生まれ持った性格と才能
・仕事で成功しやすいスタイル
・お金との付き合い方
・人間関係の特徴
・恋愛・家庭
・人生で大きく伸びる時期
・注意すべき時期
・2026〜2030年の運勢
・今の自分が何をすると運を活かせるか

を具体的に解説してください。

専門用語を使う場合は、必ず小学生にも分かる言葉に言い換えてください。
単なる占い結果ではなく、「なぜそう判断できるのか」も説明してください。`,
  },
  {
    id: "rokusei", icon: "⭐", title: "六星占術", lead: "生年月日から、星人と運命周期（運気の流れ）を出して、今やること・避けることまで読みます", needTime: false,
    prompt: `あなたは六星占術の専門家です。
私の生年月日から星人・運命周期を正確に判定してください。

そのうえで、
・本来の性格
・才能と弱点
・仕事運・金運
・人間関係
・恋愛・家庭
・人生の転機
・現在の運気
・2026〜2030年の流れ
・今やるべきこと／避けたほうがいいこと

を具体的に教えてください。

「今年は運気が悪い」だけで終わらせず、
実生活ではどう行動すればいいのかまで落とし込んでください。`,
  },
  {
    id: "animal", icon: "🐯", title: "動物占い", lead: "生年月日から、あなたのキャラクター（個性心理學）を出して、強みと弱点を読みます", needTime: false,
    prompt: `あなたは動物占い（個性心理學）の専門家です。
私の生年月日から正確なキャラクターを判定してください。

・本来の性格
・他人からどう見られやすいか
・仕事で発揮する強み
・苦手な人との付き合い方
・リーダーとしての特徴
・恋愛・家庭での特徴
・自分では気づきにくい弱点
・才能を最大限活かす方法

を、具体例を交えて説明してください。

耳の痛い内容も遠慮せず教えてください。
最後に「このタイプが人生で成功するための3つの行動」をまとめてください。`,
  },
];

export interface FortuneInput { kind: FortuneKind; birth: string; time?: string; place?: string; today: string }

const jp = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

/** AIに送る全文（自分の情報＋決めた指示文） */
export function fortunePrompt(i: FortuneInput): string {
  const k = FORTUNE_KINDS.find((x) => x.id === i.kind);
  if (!k) throw new Error("占いの種類が正しくありません");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.birth) || i.birth < "1900-01-01" || i.birth > i.today) throw new Error("生年月日を、正しく入れてください");
  const info = [`生年月日：${jp(i.birth)}`];
  if (k.needTime) {
    info.push(`出生時間：${i.time && /^\d{2}:\d{2}$/.test(i.time) ? i.time : "わかりません（時間がわからない場合は、その前提で、年・月・日の3つの柱で読んでください）"}`);
    info.push(`出生地：${(i.place ?? "").trim().slice(0, 40) || "日本（くわしくはわかりません）"}`);
  }
  info.push(`今日の日付：${jp(i.today)}`);
  return `【私の情報】\n${info.join("\n")}\n\n${k.prompt}`;
}
