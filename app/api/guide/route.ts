import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { GUIDES } from "@/lib/guides";
import { ForbiddenError, getMe } from "@/lib/service";

// アプリ制作者（app_owner）だけ。鬼塚さん・正美さん（管理者）にも見せない
export const GET = authed(async (userId) => {
  const me = await getMe(await getDb(), userId);
  if (!me?.appOwner) throw new ForbiddenError("この画面は、アプリ制作者だけが見られます");
  return json(GUIDES);
});
