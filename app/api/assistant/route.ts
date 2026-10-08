import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { askAssistant } from "@/lib/service";

// { question, history? } → { answer, ai }。会話は保存しない・記録にも残さない（書き込みではないので、見るだけの社長も使える）
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { question?: string; history?: { role: "user" | "assistant"; content: string }[] };
  return json(await askAssistant(await getDb(), userId, { question: String(b.question ?? ""), history: Array.isArray(b.history) ? b.history : [] }));
});
