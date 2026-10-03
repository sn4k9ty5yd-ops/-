// Notion から書き出した内容を、マニュアルに取り込む。
//   npx tsx scripts/manual-import.ts <書き出しファイル.json> [--prod]
// --prod のときは、環境変数 MANUAL_DB_URL（NeonのURI）へHTTPSでつなぐ。なければ手元のお試しDB。
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { getDb } from "../lib/db";
import { parseEnhancedMarkdown } from "../lib/manual/enhanced-markdown";
import type { Block } from "../lib/manual/blocks";
import { importManualPages, type FetchedAsset, type ImportPage } from "../lib/manual/import";
import { neonHttp } from "./neon-http";

interface Entry {
  sourceId: string; parentSourceId?: string | null; title: string; icon?: string;
  markdown?: string; blocks?: Block[];
  ownerName?: string; storeName?: string; minLevel?: number; editLevel?: number; evaluatorsEdit?: boolean; sort?: number;
}

async function fetchAsset(src: string): Promise<FetchedAsset | null> {
  const r = await fetch(src, { redirect: "follow" });
  if (!r.ok) return null;
  const data = Buffer.from(await r.arrayBuffer());
  const mime = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "file");
  return { data, mime, name };
}
async function compress(a: FetchedAsset): Promise<FetchedAsset> {
  if (!/^image\/(png|jpeg|webp)$/.test(a.mime)) return a;     // GIFなどは、そのまま
  const out = await sharp(a.data).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  return out.length < a.data.length ? { data: out, mime: "image/webp", name: a.name.replace(/\.\w+$/, "") + ".webp" } : a;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("使い方: npx tsx scripts/manual-import.ts <書き出し.json> [--prod]");
  const prod = process.argv.includes("--prod");
  const db = prod ? neonHttp(process.env.MANUAL_DB_URL ?? (() => { throw new Error("MANUAL_DB_URL がありません"); })()) : await getDb();
  const co = (await db.query<{ id: string }>("select id from companies where status = 'active' order by created_at limit 1")).rows[0]?.id;
  if (!co) throw new Error("会社がありません");
  const entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];
  const pages: ImportPage[] = entries.map((e) => ({ ...e, blocks: e.blocks ?? parseEnhancedMarkdown(e.markdown ?? "") }));
  const rep = await importManualPages(db, co, pages, { fetchAsset, compress, log: (s) => console.log(s) });
  console.log(JSON.stringify(rep, null, 1));
  await db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
