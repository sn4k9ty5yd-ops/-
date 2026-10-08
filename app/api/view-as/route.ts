import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { setViewAs } from "@/lib/service";
import { VIEW_AS_PRESETS } from "@/lib/db/view-as";

export const GET = authed(async () => json(VIEW_AS_PRESETS.map((p) => ({ key: p.key, label: p.label }))));
// { key: "manager" | ... | null } → アプリ制作者だけ。ほかのレベルの見え方に切りかえる（null でもとにもどる）
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { key?: string | null };
  return json(await setViewAs(await getDb(), userId, b.key ?? null));
});
