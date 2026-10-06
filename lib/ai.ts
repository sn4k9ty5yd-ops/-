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

/** AIの会社から、エラーが返ってきたとき。detail は、向こうの説明（原因をつかむため。カギは含めない） */
export class AiHttpError extends Error {
  constructor(message: string, public status: number, public detail: string) { super(message); }
}
async function httpError(res: Response, key: string): Promise<AiHttpError> {
  let detail = "";
  try { const j = (await res.clone().json()) as { error?: { message?: string; status?: string } }; detail = [j.error?.status, j.error?.message].filter(Boolean).join("："); } catch { /* 読めなくてもよい */ }
  detail = detail.split(key).join("（カギ）").slice(0, 300);
  return new AiHttpError(aiHttpMessage(res.status), res.status, detail);
}

let geminiModel: string | null = null;   // 自動で見つけたモデル（サーバーを再起動するまで、おぼえておく）
export const resetGeminiModel = () => { geminiModel = null; };

/** 使えるモデルの一覧から、generateContent が使える、いちばん新しい「flash」（lite・画像・音声・実験版でないもの）をえらぶ */
export async function discoverGeminiModel(f: Fetch, key: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const r = await f("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { signal, headers: { "x-goog-api-key": key } });
    if (!r.ok) return null;
    const j = (await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    const cands = (j.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .map((n) => ({ n, v: /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(n)?.[1] }))
      .filter((x): x is { n: string; v: string } => !!x.v)
      .sort((a, b) => Number(b.v) - Number(a.v));
    return cands[0]?.n ?? null;
  } catch { return null; }
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
      const body = JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
        generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens },
      });
      const key = env.GEMINI_API_KEY!;
      const post = (url: string, extra: Record<string, string> = { "x-goog-api-key": key }) => f(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", ...extra }, body });
      let first: Response | null = null;
      // 1つのモデルを、入口をかえながら試す（「AQ.」のカギは、ふつうの入り口で通らないことがあるので、Vertex AI の入り口でも試す）
      const tryModel = async (model: string): Promise<Response> => {
        const m = encodeURIComponent(model);
        const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`);
        if (r.ok || !key.startsWith("AQ.") || ![400, 401, 403, 404].includes(r.status)) return r;
        first = r;
        const alt = await post(`https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`);
        if (alt.ok) return alt;
        const alt2 = await post(`https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {});
        return alt2.ok ? alt2 : alt;
      };
      let model = env.AI_MODEL || geminiModel || "gemini-2.5-flash";
      let res = await tryModel(model);
      // モデルの名前が古くて見つからない（404）ときは、いま使えるモデルを調べて、いちばん新しい「flash」に切りかえる（AI_MODEL を決めているときは、そのまま）
      if (res.status === 404 && !env.AI_MODEL) {
        const found = await discoverGeminiModel(f, key, ctl.signal);
        if (found && found !== model) { geminiModel = found; model = found; first = null; res = await tryModel(model); }
      }
      if (!res.ok) { const e = await httpError(res, key); if (first) { const e1 = await httpError(first, key); e.detail = `入口1（${(first as Response).status}）${e1.detail} ／ 入口2（${res.status}）${e.detail}`.slice(0, 500); } e.detail = `モデル：${model} ／ ${e.detail}`.slice(0, 600); throw e; }
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
    if (!res.ok) throw await httpError(res, env.ANTHROPIC_API_KEY!);
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
  if (status === 404) return "AIの宛先（モデル）が見つかりませんでした（404）。カギの種類か、AIの名前が合っていないようです";
  return `AIがうまく動きませんでした（${status}）。しばらくしてから、もう一度ためしてください`;
}
