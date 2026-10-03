import { createHash } from "node:crypto";
import type { Queryable } from "../db/types";
import { assignIds, collectSources, mapSources, markTablesEditable, plainText, type Block } from "./blocks";

export interface ImportPage {
  sourceId: string;                 // 取り込み元のID（Notionの32けた）
  parentSourceId?: string | null;
  title: string;
  icon?: string;
  blocks: Block[];
  sort?: number;
  /** 本人（名前で探す。ひとりに決まったときだけ設定） */
  ownerName?: string;
  /** 取り込み元のお店の名前（ATENA天神 など）。お店の名前に合うときだけ設定 */
  storeName?: string;
  minLevel?: number; editLevel?: number; evaluatorsEdit?: boolean;
  /** 表のマスに書き込める（評価表など） */
  editableTables?: boolean;
}
export interface FetchedAsset { data: Buffer; mime: string; name: string }
export interface ImportOptions {
  /** 画像・ファイルの取り出し方（Notionの一時アドレスから取ってくる）。取れなければ null */
  fetchAsset?: (src: string, kind: "img" | "file") => Promise<FetchedAsset | null>;
  /** 画像を小さくする（sharp）。省略すると、そのまま保存 */
  compress?: (a: FetchedAsset) => Promise<FetchedAsset>;
  log?: (s: string) => void;
}
export interface ImportReport { pages: number; created: number; updated: number; assets: number; assetFailures: string[]; ownerMatched: number; ownerUnmatched: string[] }

const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();

/** ページを、会社のマニュアルに取り込む（同じ取り込み元IDなら更新）。見られる人などの設定は、新しく作るときだけ決める */
export async function importManualPages(q: Queryable, companyId: string, pages: ImportPage[], opts: ImportOptions = {}): Promise<ImportReport> {
  const rep: ImportReport = { pages: pages.length, created: 0, updated: 0, assets: 0, assetFailures: [], ownerMatched: 0, ownerUnmatched: [] };
  const log = opts.log ?? (() => {});
  const members = (await q.query<{ id: string; name: string; status: string }>("select id, name, status from memberships where company_id = $1", [companyId])).rows;
  const stores = (await q.query<{ id: string; name: string }>("select id, name from stores where company_id = $1", [companyId])).rows;
  const bySource = new Map<string, string>();
  for (const r of (await q.query<{ id: string; source_id: string }>("select id, source_id from manual_pages where company_id = $1 and source_id is not null", [companyId])).rows) bySource.set(r.source_id, r.id);

  const assetCache = new Map<string, string | null>();
  const saveAsset = async (src: string, kind: "img" | "file"): Promise<string> => {
    if (src.startsWith("asset:") || !/^https?:\/\//.test(src) || !opts.fetchAsset) return src;
    if (assetCache.has(src)) return assetCache.get(src) ?? src;
    let got = await opts.fetchAsset(src, kind).catch(() => null);
    if (!got) { rep.assetFailures.push(src.slice(0, 120)); assetCache.set(src, null); return src; }
    if (opts.compress && got.mime.startsWith("image/")) got = await opts.compress(got).catch(() => got as FetchedAsset);
    const sha = createHash("sha256").update(got.data).digest("hex");
    const hex = got.data.toString("hex");
    const r = await q.query<{ id: string }>(
      `insert into manual_assets (company_id, name, mime, size, sha, data) values ($1,$2,$3,$4,$5,decode($6::text, 'hex'))
       on conflict (company_id, sha) do update set name = excluded.name returning id`,
      [companyId, got.name.slice(0, 200), got.mime, got.data.length, sha, hex]);
    rep.assets++;
    const ref = `asset:${r.rows[0].id}`;
    assetCache.set(src, ref);
    return ref;
  };

  // 親が先になるように並べる
  const order: ImportPage[] = [];
  const seen = new Set<string>();
  const byId = new Map(pages.map((p) => [p.sourceId, p]));
  const visit = (p: ImportPage, depth = 0) => {
    if (seen.has(p.sourceId) || depth > 30) return;
    const par = p.parentSourceId ? byId.get(p.parentSourceId) : undefined;
    if (par) visit(par, depth + 1);
    seen.add(p.sourceId); order.push(p);
  };
  pages.forEach((p) => visit(p));

  let n = 0;
  for (const p of order) {
    n++;
    const mapped = await mapSources(p.blocks, saveAsset);
    const blocks = assignIds(p.editableTables ? markTablesEditable(mapped) : mapped);
    const parentId = p.parentSourceId ? bySource.get(p.parentSourceId) ?? null : null;
    let ownerId: string | null = null;
    if (p.ownerName) {
      const hits = members.filter((m) => norm(m.name) === norm(p.ownerName!) || norm(p.ownerName!).includes(norm(m.name)) && norm(m.name).length >= 3);
      const active = hits.filter((m) => m.status === "active");
      const pick = active.length === 1 ? active[0] : hits.length === 1 ? hits[0] : null;
      if (pick) { ownerId = pick.id; rep.ownerMatched++; } else rep.ownerUnmatched.push(p.ownerName);
    }
    const storeId = p.storeName ? stores.find((s) => norm(s.name) === norm(p.storeName!))?.id ?? null : null;
    const existing = bySource.get(p.sourceId);
    if (existing) {
      await q.query(
        "update manual_pages set title = $2, icon = $3, body = $4::jsonb, parent_id = $5, sort_order = $6, updated_at = now() where id = $1",
        [existing, p.title || "（題名なし）", p.icon ?? "", JSON.stringify(blocks), parentId, p.sort ?? n]);
      rep.updated++;
    } else {
      const r = await q.query<{ id: string }>(
        `insert into manual_pages (company_id, parent_id, title, icon, body, sort_order, min_level, edit_level, store_id, owner_id, evaluators_edit, source_id)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [companyId, parentId, p.title || "（題名なし）", p.icon ?? "", JSON.stringify(blocks), p.sort ?? n, p.minLevel ?? 1, p.editLevel ?? 4, storeId, ownerId, p.evaluatorsEdit ?? false, p.sourceId]);
      bySource.set(p.sourceId, r.rows[0].id);
      rep.created++;
    }
    if (n % 20 === 0) log(`${n}/${order.length} ページ`);
  }
  void collectSources; void plainText;
  return rep;
}
