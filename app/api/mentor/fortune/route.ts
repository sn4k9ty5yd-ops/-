import { aiStatus } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { FortuneKind } from "@/lib/fortune-ai";
import { loadAiKey, runFortuneAi } from "@/lib/service";

export const GET = authed(async () => { await loadAiKey(await getDb()); return json({ aiAvailable: aiStatus().available }); });

// { kind, birth, time?, place? } → 占いの文章。サーバーには保存しない（記録にも残さない）
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { kind?: FortuneKind; birth?: string; time?: string; place?: string };
  return json(await runFortuneAi(await getDb(), userId, { kind: b.kind as FortuneKind, birth: String(b.birth ?? ""), time: b.time, place: b.place }));
}, { write: true });
