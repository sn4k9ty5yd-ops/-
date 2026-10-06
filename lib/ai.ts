/** AI（文章をつくる機能）の呼び出し。料金がかからない枠のあるサービスをつかう。カギ（キー）は、サーバーの設定に入れる（画面・記録には出さない）。
 *  GEMINI_API_KEY（Google・無料枠あり）か ANTHROPIC_API_KEY（Claude・有料）のどちらかがあれば使える。 */
export interface AiStatus { available: boolean; provider: "gemini" | "anthropic" | null }

// アプリの画面（制作者だけの「AIのカギ」）から入れたカギ。サーバーの設定よりも優先する
let stored: string | null = null;
export function setStoredAiKey(k: string | null) { stored = k && k.trim() ? k.trim() : null; }
/** カギの形から、どのサービスのカギかを見分ける */
export function providerOfKey(k: string): "gemini" | "anthropic" | null {
  if (/^sk-ant-[0-9A-Za-z_-]{20,}$/.test(k)) return "anthropic";
  // Googleのカギは「AIza…」のほかに、新しい形（「AQ.…」「AS…」など）もある。文字の種類と長さだけ見て、Geminiのカギとして扱う
  if (/^[0-9A-Za-z_.-]{20,300}$/.test(k)) return "gemini";
  return null;
}
export function effectiveEnv(): Record<string, string | undefined> {
  const p = stored ? providerOfKey(stored) : null;
  if (!stored || !p) return process.env;
  return p === "gemini" ? { ...process.env, GEMINI_API_KEY: stored, ANTHROPIC_API_KEY: undefined } : { ...process.env, ANTHROPIC_API_KEY: stored, GEMINI_API_KEY: undefined };
}

export function aiStatus(env: Record<string, string | undefined> = effectiveEnv()): AiStatus {
  if (env.GEMINI_API_KEY) return { available: true, provider: "gemini" };
  if (env.ANTHROPIC_API_KEY) return { available: true, provider: "anthropic" };
  return { available: false, provider: null };
}

export class AiUnavailableError extends Error {
  constructor() { super("AIの準備がまだです（管理者がカギを設定すると使えます）。いまは「プロンプトをコピー」で、ほかのAIに貼って使えます"); }
}

type Fetch = typeof fetch;

export interface ChatTurn { role: "user" | "assistant"; content: string }

export async function callAi(prompt: string, opts: { env?: Record<string, string | undefined>; fetchFn?: Fetch; timeoutMs?: number } = {}): Promise<string> {
  return callAiChat("", [{ role: "user", content: prompt }], opts);
}

/** 会話（やりとりの続き）を渡して、次の返事をもらう。system は、キャラや決まり */
export async function callAiChat(system: string, turns: ChatTurn[], opts: { env?: Record<string, string | undefined>; fetchFn?: Fetch; timeoutMs?: number; maxTokens?: number } = {}): Promise<string> {
  const env = opts.env ?? effectiveEnv();
  const f = opts.fetchFn ?? fetch;
  const st = aiStatus(env);
  if (!st.available) throw new AiUnavailableError();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120000);
  const maxTokens = opts.maxTokens ?? 8192;
  try {
    if (st.provider === "gemini") {
      const model = env.AI_MODEL || "gemini-2.5-flash";
      const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
          generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens },
        }),
      });
      if (!res.ok) throw new Error(aiHttpMessage(res.status));
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (!text) throw new Error("AIから、答えが返ってきませんでした。もう一度ためしてください");
      return text;
    }
    const res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.AI_MODEL || "claude-haiku-4-5-20251001", max_tokens: maxTokens, ...(system ? { system } : {}), messages: turns }),
    });
    if (!res.ok) throw new Error(aiHttpMessage(res.status));
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    if (!text) throw new Error("AIから、答えが返ってきませんでした。もう一度ためしてください");
    return text;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("AIの返事に時間がかかりすぎました。もう一度ためしてください");
    throw e;
  } finally { clearTimeout(timer); }
}

function aiHttpMessage(status: number): string {
  if (status === 429) return "AIの無料の利用回数を、いったん使いきりました。しばらくしてから、もう一度ためしてください";
  if (status === 401 || status === 403) return "AIのカギが正しくないようです（管理者に伝えてください）";
  return `AIがうまく動きませんでした（${status}）。しばらくしてから、もう一度ためしてください`;
}
