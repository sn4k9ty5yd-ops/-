import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { createProducts, listProducts, type ProductInput, type ProductKind } from "@/lib/service";

const kindOf = (v: string | null): ProductKind => { if (v !== "retail" && v !== "supply") throw new Error("種類（店販・業務）を指定してください"); return v; };

export const GET = authed(async (userId, req) => json(await listProducts(await getDb(), userId, kindOf(new URL(req.url).searchParams.get("kind")))));
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as { kind?: string; items?: ProductInput[]; storeIds?: string[] };
  if (!b.items?.length) throw new Error("商品がありません");
  if (b.items.length > 1000) throw new Error("一度に登録できるのは1000件までです");
  return json(await createProducts(await getDb(), userId, kindOf(b.kind ?? null), b.items, b.storeIds ?? []));
}, { write: true });
