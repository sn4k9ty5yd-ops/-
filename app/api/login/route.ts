import { NextResponse } from "next/server";
import { login, recordLogin } from "@/lib/auth/login";
import { getDb } from "@/lib/db";
import { COOKIE, COOKIE_MAX_AGE, isJson } from "@/lib/http";

// 同じ場所（IP）から、短い時間にたくさん試されたら止める（いろいろな社員番号を順番に試す攻撃への対策）
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000, MAX_TRIES = 30;
function throttled(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return list.length > MAX_TRIES;
}

export async function POST(req: Request) {
  if (!isJson(req)) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : "");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ua = req.headers.get("user-agent") ?? "";
  const db = await getDb();
  const company = str(b.company), code = str(b.code);
  if (throttled(ip)) {
    await recordLogin(db, { companyCode: company, employeeCode: code, ok: false, reason: "throttled", ip, ua }).catch(() => {});
    return NextResponse.json({ error: "短い時間に、たくさん試されました。しばらくしてから、もう一度ためしてください。" }, { status: 429 });
  }
  const r = await login(db, { companyCode: company, employeeCode: code, passcode: str(b.passcode) });
  if (!r.ok) {
    await recordLogin(db, { companyCode: company, employeeCode: code, ok: false, reason: r.reason, ip, ua }).catch(() => {});
    const msg = r.reason === "locked" ? "ログインに続けて失敗したため、しばらく使えません。オフィスに連絡してください。" : "会社ID・社員番号・パスコードのいずれかが違います";
    return NextResponse.json({ error: msg }, { status: r.reason === "locked" ? 429 : 401 });
  }
  await recordLogin(db, { companyCode: company, employeeCode: code, ok: true, reason: "ok", ip, ua, membershipId: r.membershipId }).catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, r.token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
