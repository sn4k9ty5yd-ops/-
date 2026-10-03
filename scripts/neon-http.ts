// 本番のデータベース(Neon)へ、HTTPS経由で命令を送る小さな接続。取り込み用（TCPで直接つなげない環境のため）
import type { Database, Queryable } from "../lib/db/types";

export function neonHttp(connectionString: string): Database {
  const host = connectionString.replace(/^.*@/, "").replace(/\/.*$/, "");
  const call = async (body: object) => {
    const r = await fetch(`https://${host}/sql`, { method: "POST", headers: { "Neon-Connection-String": connectionString, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { rows?: unknown[]; message?: string; results?: { rows: unknown[] }[] };
    if (!r.ok) throw new Error(j.message ?? `Neon HTTP ${r.status}`);
    return j;
  };
  const q: Queryable = {
    query: async (sql, params) => ({ rows: ((await call({ query: sql, params: (params ?? []).map((p) => (p instanceof Date ? p.toISOString() : p)) })).rows ?? []) as never }),
  };
  return {
    ...q,
    tx: async (fn) => fn(q),      // 取り込みは、同じページを何度でも入れ直せる作り（途中で止まっても、やり直せる）
    close: async () => {},
  };
}
