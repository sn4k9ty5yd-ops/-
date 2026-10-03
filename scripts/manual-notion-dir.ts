// Notion の「HTMLで書き出し」を解いたフォルダ（または、いくつかのHTMLファイル）を、マニュアルに取り込む。
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/manual-notion-dir.ts <フォルダ> [--prod]
// 画像などは、HTMLの隣のフォルダから読む（見つからないものは「取り込み待ち」のまま。あとで足して、もう一度実行すれば更新される）。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import sharp from "sharp";
import { getDb } from "../lib/db";
import type { Block } from "../lib/manual/blocks";
import { importManualPages, type FetchedAsset, type ImportPage } from "../lib/manual/import";
import { parseNotionHtml } from "../lib/manual/notion-html";
import { neonHttp } from "./neon-http";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
const rewriteSrc = (blocks: Block[], baseDir: string): Block[] => blocks.map((b) => {
  if ((b.t === "img" || b.t === "file") && !/^(https?:|asset:)/.test(b.src)) {
    const f = resolve(baseDir, decodeURIComponent(b.src));
    return { ...b, src: existsSync(f) ? `file://${f}` : b.src };
  }
  if (b.t === "cols") return { ...b, cols: b.cols.map((c) => rewriteSrc(c, baseDir)) };
  if ("children" in b && b.children) return { ...b, children: rewriteSrc(b.children, baseDir) } as Block;
  return b;
});

async function fetchAsset(src: string): Promise<FetchedAsset | null> {
  if (src.startsWith("file://")) {
    const f = src.slice(7);
    if (!existsSync(f)) return null;
    return { data: readFileSync(f), mime: MIME[extname(f).toLowerCase()] ?? "application/octet-stream", name: basename(f) };
  }
  const r = await fetch(src); if (!r.ok) return null;
  return { data: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get("content-type") ?? "").split(";")[0] || "application/octet-stream", name: decodeURIComponent(new URL(src).pathname.split("/").pop() || "file") };
}
async function compress(a: FetchedAsset): Promise<FetchedAsset> {
  if (!/^image\/(png|jpeg|webp)$/.test(a.mime)) return a;
  const out = await sharp(a.data).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  return out.length < a.data.length ? { data: out, mime: "image/webp", name: a.name.replace(/\.\w+$/, "") + ".webp" } : a;
}

/** 売上など、見られる人を限りたい「数字管理」は、別ページに分けて管理者だけにする */
const SECRET_TITLES = [/^数字管理/, /売上/, /議事録/, /1on1|１on１|面談/];

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("使い方: npx tsx scripts/manual-notion-dir.ts <フォルダ> [--prod]");
  const prod = process.argv.includes("--prod");
  const db = prod ? neonHttp(process.env.MANUAL_DB_URL ?? (() => { throw new Error("MANUAL_DB_URL がありません"); })()) : await getDb();
  const co = (await db.query<{ id: string }>("select id from companies where status = 'active' order by created_at limit 1")).rows[0]?.id;
  if (!co) throw new Error("会社がありません");

  const files = walk(dir).filter((f) => f.toLowerCase().endsWith(".html"));
  const pages: ImportPage[] = [];
  const parentOf = new Map<string, string>();
  for (const f of files) {
    const p = parseNotionHtml(readFileSync(f, "utf8"));
    if (!p.sourceId) continue;
    let blocks = rewriteSrc(p.blocks, dirname(f));
    const secret: ImportPage[] = [];
    // 「数字管理」のトグルなどは、別の管理者専用ページへ
    blocks = blocks.filter((b) => {
      if (b.t === "toggle" && SECRET_TITLES.some((re) => re.test(b.x))) {
        secret.push({ sourceId: `${p.sourceId}s${secret.length}`, parentSourceId: p.sourceId, title: b.x, icon: "🔒", blocks: b.children, minLevel: 4 });
        return false;
      }
      return true;
    });
    pages.push({ sourceId: p.sourceId, title: p.title, icon: p.icon, blocks, minLevel: SECRET_TITLES.some((re) => re.test(p.title)) ? 4 : 1 }, ...secret);
    for (const c of p.childIds) if (!parentOf.has(c)) parentOf.set(c, p.sourceId);
  }
  for (const pg of pages) if (!pg.parentSourceId && parentOf.has(pg.sourceId)) pg.parentSourceId = parentOf.get(pg.sourceId);
  console.log(`ページ ${pages.length} 件を取り込みます`);
  const rep = await importManualPages(db, co, pages, { fetchAsset, compress, log: (s) => console.log(s) });
  console.log(JSON.stringify({ ...rep, assetFailures: rep.assetFailures.length }, null, 1));
  await db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
