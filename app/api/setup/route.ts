import { timingSafeEqual } from "node:crypto";
import { bootstrapCompany, DEFAULT_STORE_NAMES } from "@/lib/bootstrap";
import { getDb } from "@/lib/db";
import { isJson, json } from "@/lib/http";

const keyOk = (given: string) => {
  const real = process.env.SETUP_KEY ?? "";
  if (real.length < 16) return false;
  const a = Buffer.from(given), b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
};
const alreadyDone = async () => ((await (await getDb()).query<{ n: number }>("select count(*)::int as n from companies")).rows[0].n) > 0;

/** 初期設定が必要か（まだ会社が1つも無く、合言葉(SETUP_KEY)が設定されているとき） */
export async function GET() {
  const configured = (process.env.SETUP_KEY ?? "").length >= 16;
  return json({ needed: configured && !(await alreadyDone()), configured });
}

/**
 * 最初の1回だけ使える初期設定。会社・5店舗・管理者を作る。
 * 合言葉(SETUP_KEY)が一致し、かつ会社がまだ1つも無いときだけ動く。作ったあとは二度と動かない。
 */
export async function POST(req: Request) {
  if (!isJson(req)) return json({ error: "不正なリクエストです" }, 400);
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (await alreadyDone()) return json({ error: "初期設定は、すでに終わっています" }, 403);
  if (!keyOk(b.key ?? "")) { await new Promise((r) => setTimeout(r, 1500)); return json({ error: "合言葉が違います" }, 403); }
  const companyCode = (b.companyCode ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,32}$/.test(companyCode)) return json({ error: "会社IDは、英小文字・数字・ハイフンの3〜32文字にしてください" }, 400);
  if (!b.companyName?.trim() || !b.officeName?.trim() || !/^[A-Za-z0-9]{1,20}$/.test((b.officeCode ?? "").trim())) return json({ error: "会社名・管理者の名前・社員番号（英数字）を入れてください" }, 400);
  try {
    const r = await bootstrapCompany(await getDb(), { companyCode, companyName: b.companyName.trim(), officeName: b.officeName.trim(), officeCode: b.officeCode.trim() });
    return json({ companyCode, employeeCode: r.office.employeeCode, passcode: r.office.passcode, stores: [...DEFAULT_STORE_NAMES] });
  } catch (e) { return json({ error: (e as Error).message }, 400); }
}
