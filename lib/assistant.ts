/** 右下の「？」ボタンのアシスタント。やり方の説明（ヘルプ）を材料に、AIが答える。AIが使えないときは、近い説明をそのまま出す */
import { HELP, type HelpTopic } from "./help";
import type { Me } from "./service";

/** そのひとが使える説明だけ */
export function topicsFor(me: Pick<Me, "level" | "materialManager" | "eduLead">): HelpTopic[] {
  return HELP.filter((t) => me.level >= (t.min ?? 1) && (t.flag !== "material" || me.level === 4 || !!me.materialManager) && (t.flag !== "edu" || me.level >= 3 || !!me.eduLead));
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s、。！？!?,.「」（）()・\-ー]/g, "");

/** 質問に近い説明を、近い順に（2文字ずつの一致で数える） */
export function pickTopics(question: string, topics: HelpTopic[], n = 4): HelpTopic[] {
  const q = norm(question);
  if (q.length === 0) return [];
  const grams = new Set<string>(); for (let i = 0; i < q.length - 1; i++) grams.add(q.slice(i, i + 2));
  if (q.length === 1) grams.add(q);
  const docs = topics.map((t) => ({ t, title: norm(t.title), body: norm(`${t.what}${t.steps.join("")}${(t.tips ?? []).join("")}`) }));
  // めずらしい言葉ほど、大事にする（「変えたい」のように、どこにでもある言葉は、ほとんど数えない）
  const idf = new Map<string, number>();
  for (const g of grams) { const df = docs.filter((d) => d.title.includes(g) || d.body.includes(g)).length; idf.set(g, df === 0 ? 0 : Math.log(1 + docs.length / df)); }
  const scored = docs.map((d) => {
    let s = 0; for (const g of grams) { const w = idf.get(g) ?? 0; if (d.title.includes(g)) s += 4 * w; else if (d.body.includes(g)) s += w; }
    return { t: d.t, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map((x) => x.t);
}

const topicText = (t: HelpTopic) => `■${t.title}（使う人：${t.who}）\n${t.what}\n${t.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}${t.tips?.length ? `\n※ ${t.tips.join(" / ")}` : ""}`;

export function assistantSystemPrompt(me: Pick<Me, "name" | "level">, all: HelpTopic[], picked: HelpTopic[]): string {
  return [
    "あなたは、美容室の業務アプリ「ALBUM」の、やさしい案内係です。画面の右下の「？」から、スタッフの質問に答えます。",
    "ルール：",
    "- ITが苦手な人に話しかけるつもりで、やさしい日本語で、短く答える。むずかしい言葉は使わない。",
    "- 答えは、「1. ◯◯を押します」のように、ボタンの名前どおりに、1ステップずつ。最大6ステップ。",
    "- 下の「説明」に書いてあることだけを根拠にする。書いていないこと・わからないことは、知ったかぶりをせず「その機能は、説明にはありません。『ご要望』から、アプリを作っている人に聞いてください」と答える。",
    "- パスコードや個人の情報は、たずねない・答えない。アプリの外の話（天気・雑談・ほかのサービス）は、「アプリのことなら、お答えします」と、やんわり断る。",
    `- いま質問している人：${me.name.replace(/\s+/g, "").slice(0, 10)}さん。使える機能は、下の説明にある範囲だけ。使えない機能のことは、「その機能は、いまの権限では使えません。店長か事務員さんに聞いてください」と答える。`,
    "",
    "【使える機能の一覧】",
    all.map((t) => `・${t.title}`).join("\n"),
    "",
    "【説明（質問に近いもの）】",
    picked.length ? picked.map(topicText).join("\n\n") : "（近い説明が見つかりませんでした。一覧から、いちばん近い機能を選んで答えてください）",
  ].join("\n");
}

/** AIが使えないときの答え：近い説明を、そのまま出す */
export function localAnswer(question: string, topics: HelpTopic[]): string {
  const found = pickTopics(question, topics, 3);
  if (found.length === 0) return "うまく見つかりませんでした。ちがう言葉（「休み」「売上」「棚卸し」「パスコード」など）で、もう一度聞いてみてください。それでもわからないときは、「ご要望・困りごと」のタブから送ってください。";
  const [best, ...rest] = found;
  return `【${best.title}】\n${best.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}${rest.length ? `\n\nほかに近い説明：${rest.map((t) => `「${t.title.split("（")[0]}」`).join("・")}（名前を入れて、聞いてみてください）` : ""}`;
}
