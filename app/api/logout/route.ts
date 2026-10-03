import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { logout } from "@/lib/auth/login";
import { getDb } from "@/lib/db";
import { COOKIE, isJson } from "@/lib/http";

export async function POST(req: Request) {
  if (!isJson(req)) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await logout(await getDb(), token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
