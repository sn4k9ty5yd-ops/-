/** ミーティングのAIに渡す指示（プロンプト）と、返ってきた文字の読み取り。AIの会社が変わっても使える */

export const MINUTES_MAX = 60000;   // 文字起こしの最大の長さ（これより長いときは、後ろを切る）

/** AI会議の指示書（ユーザーが決めた文章。テーマだけを入れかえる） */
export function discussionPrompt(theme: string): string {
  const t = theme.trim();
  return `#指示書
以下を一度深呼吸して、ステップバイステップで実行してください。
STEP1:${t}を設定
STEP2:${t}に関する議論に最適な人格を3人生成してください。
STEP3:${t}について5回会話してください。
STEP4:会話文の内容から論点を抽出し、結論を示してください。
STEP5:結論を元に実施すべき行動計画を立ててください。
#制約条件
STEP3の各人格の発言は全文記載すること
行動計画は箇条書きで示してください
それでは、議論のテーマは{${t}}でお願いします。はじめてください。`;
}

const clip = (s: string) => (s.length > MINUTES_MAX ? s.slice(0, MINUTES_MAX) + "\n（長いので、ここから後ろは省きました）" : s);

export function minutesPrompt(transcript: string, title = "", heldOn = "", attendees = ""): string {
  return `あなたは、美容室の会議の書記です。次の「文字起こし」から、読みやすい議事録を日本語で作ってください。
文字起こしには、聞きまちがい・言いまちがい・「えーと」などが入っています。意味が通るように直し、ないことは書かないでください。

【書き方】
■ 会議名・日付・参加者
■ 議題（番号をつけて）
■ 議題ごとの話し合いの内容（短く、箇条書き）
■ 決まったこと
■ やること（だれが・なにを・いつまでに。わからない項目は「未定」）
■ 次回に持ち越すこと

会議名：${title || "（未記入）"}
日付：${heldOn || "（未記入）"}
参加者：${attendees || "（未記入）"}

【文字起こし】
${clip(transcript)}`;
}

export function summaryPrompt(text: string): string {
  return `次の会議の内容を、日本語で、忙しい人が30秒で読める長さに要約してください。
【書き方】
■ ひとことで（1〜2文）
■ 大事なポイント（3〜5個・箇条書き）
■ 決まったこと
■ やること（だれが・なにを・いつまで）
■ 課題・気になること（次に話し合うべきこと）
ないことは書かないでください。

【会議の内容】
${clip(text)}`;
}

export function mindmapPrompt(text: string): string {
  return `次の会議の内容から、マインドマップを作ります。
JSONだけを出力してください（前後の説明や \`\`\` は書かない）。形は次のとおり：
{"title":"会議名","children":[{"title":"枝の名前","children":[{"title":"小枝","children":[]}]}]}
【ルール】
・深さは最大3段（中心 → 枝 → 小枝）
・枝は3〜7個、小枝は1つの枝に最大6個
・題名は、短く（20文字以内）
・日本語

【会議の内容】
${clip(text)}`;
}

/** 「この議事録の課題」を、AI会議のテーマにするためのひとこと取り出し */
export function themePrompt(text: string): string {
  return `次の会議の内容から、「次に深く話し合うと良い、いちばん大きな課題」を1つ選び、会議のテーマとして、1文（60文字以内）で書いてください。テーマの文だけを出力してください。

【会議の内容】
${clip(text)}`;
}

export interface MindNode { title: string; children: MindNode[] }

/** AIが返した文字から、マインドマップの木を取り出す（前後に説明や ``` がついていても読める。深さ3・数に上限） */
export function parseMindmap(raw: string): MindNode | null {
  const s = raw.replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let obj: unknown;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const walk = (n: unknown, depth: number): MindNode | null => {
    if (!n || typeof n !== "object") return null;
    const o = n as { title?: unknown; children?: unknown };
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 40) : "";
    if (!title) return null;
    const kids = depth >= 2 || !Array.isArray(o.children) ? [] : o.children.map((c) => walk(c, depth + 1)).filter((x): x is MindNode => !!x).slice(0, depth === 0 ? 8 : 7);
    return { title, children: kids };
  };
  return walk(obj, 0);
}
