import { NextResponse } from "next/server";
import { login } from "@/lib/auth/login";
import { getDb } from "@/lib/db";
import { COOKIE, COOKIE_MAX_AGE, isJson } from "@/lib/http";

export async function POST(req: Request) {
  if (!isJson(req)) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const r = await login(await getDb(), { companyCode: str(b.company), employeeCode: str(b.code), passcode: str(b.passcode) });
  if (!r.ok) {
    const msg = r.reason === "locked" ? "ログインに続けて失敗したため、しばらく使えません。オフィスに連絡してください。" : "会社ID・社員番号・パスコードのいずれかが違います";
    return NextResponse.json({ error: msg }, { status: r.reason === "locked" ? 429 : 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, r.token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
