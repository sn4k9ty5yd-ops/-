import { cookies } from "next/headers";
import { changeOwnPasscode, logoutOthers } from "@/lib/auth/login";
import { getDb } from "@/lib/db";
import { authed, COOKIE, json } from "@/lib/http";
import { securityOverview } from "@/lib/service";

export const GET = authed(async (userId) => json(await securityOverview(await getDb(), userId)));

// { action: "change", current, next } / { action: "logout-others" }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { action?: string; current?: string; next?: string };
  const token = (await cookies()).get(COOKIE)?.value ?? "";
  const db = await getDb();
  if (b.action === "change") { await changeOwnPasscode(db, userId, b.current ?? "", b.next ?? "", token); return json({ ok: true }); }
  if (b.action === "logout-others") return json({ count: await logoutOthers(db, userId, token) });
  throw new Error("操作が正しくありません");
}, { write: true });
