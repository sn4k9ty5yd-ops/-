import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../lib/db/migrate";
import { newDb } from "./helpers";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { aiStatus, callAi, getAiTier, providerOfKey, resetGeminiModel, setStoredAiKey } from "../lib/ai";
import { asUser } from "../lib/db/user-context";

describe("AIのカギ（アプリ制作者だけ）", () => {
  let d: Database; const u: Record<string, string> = {};
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('ai-co','T') returning id")).rows[0].id;
    const sid = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A') returning id", [co])).rows[0].id;
    const mk = async (k: string, code: string, level: number, extra = "") => {
      u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, sid, code, k, level])).rows[0].id;
      if (extra) await d.query(`update memberships set ${extra} where id = $1`, [u[k]]);
    };
    await mk("owner", "1", 4, "app_owner = true"); await mk("office", "2", 4);
  });
  const KEY = "AIzaSyDUMMYDUMMYDUMMYDUMMY12345678";
  it("形が正しいカギだけ保存でき、画面には先頭と最後の4文字しか出ない", async () => {
    expect(providerOfKey(KEY)).toBe("gemini"); expect(providerOfKey("hello")).toBeNull();
    expect(providerOfKey("AQ.Ab8RN6" + "x".repeat(30))).toBe("gemini"); expect(providerOfKey("AS" + "y".repeat(40))).toBe("gemini");   // 新しい形のカギ
    expect(providerOfKey("sk-ant-" + "z".repeat(30))).toBe("anthropic"); expect(providerOfKey("あいうえお".repeat(8))).toBeNull(); expect(providerOfKey("a b".repeat(10))).toBeNull();
    await expect(svc.setAiKey(d, u.owner, "hello")).rejects.toThrow("形が正しくありません");
    await svc.setAiKey(d, u.owner, `  ${KEY}\n`);
    const s = await svc.getAiSettings(d, u.owner);
    expect(s).toMatchObject({ available: true, provider: "gemini", source: "screen", masked: "AIza…5678" });
    expect(JSON.stringify(s)).not.toContain("DUMMYDUMMY");
    expect(aiStatus().provider).toBe("gemini");
  });
  it("制作者以外（事務員さんも）は、見る・入れる・ためす・消すが、できない。DBも見せない", async () => {
    await expect(svc.getAiSettings(d, u.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setAiKey(d, u.office, KEY)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.testAiKey(d, u.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.clearAiKey(d, u.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(asUser(d, u.owner, (q) => q.query("select * from app_secrets"))).rejects.toThrow();
  });
  it("ためす: 返事が来れば成功、失敗は日本語の知らせ。消すとAIは使えなくなる", async () => {
    expect(await svc.testAiKey(d, u.owner, async () => "OK")).toMatchObject({ ok: true });
    expect(await svc.testAiKey(d, u.owner, async () => { throw new Error("カギが正しくないようです"); })).toEqual({ ok: false, message: "カギが正しくないようです" });
    await svc.clearAiKey(d, u.owner);
    setStoredAiKey(null);
    expect((await svc.getAiSettings(d, u.owner)).source).toBe(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY ? "server" : "none");
  });
  it("「AQ.」のカギは、ふつうの入り口で通らないとき、別の入り口でも試す", async () => {
    const urls: string[] = [];
    const fake = (async (u: string) => { urls.push(u); return u.includes("aiplatform") ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "返事" }] } }] }), { status: 200 }) : new Response("{}", { status: 403 }); }) as unknown as typeof fetch;
    expect(await callAi("やあ", { env: { GEMINI_API_KEY: "AQ.Ab8" + "x".repeat(30) }, fetchFn: fake })).toBe("返事");
    expect(urls).toHaveLength(2);
    const urls2: string[] = [];
    const bad = (async (u: string) => { urls2.push(u); return new Response("{}", { status: 403 }); }) as unknown as typeof fetch;
    await expect(callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30) }, fetchFn: bad })).rejects.toThrow("カギが正しくない");
    expect(urls2).toHaveLength(1);   // AQ.以外は、そのまま失敗
  });
  it("モデルの名前が古くて404のときは、使えるモデルを調べて、いちばん新しいflashに切りかえる", async () => {
    resetGeminiModel();
    const calls: string[] = [];
    const ok = (t: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });
    const fake = (async (u: string) => {
      calls.push(u);
      if (u.includes("/models?pageSize")) return new Response(JSON.stringify({ models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }] }), { status: 200 });
      return u.includes("gemini-2.5-flash") ? new Response('{"error":{"status":"NOT_FOUND","message":"models/gemini-2.5-flash is not found"}}', { status: 404 }) : ok("新しいモデルの返事");
    }) as unknown as typeof fetch;
    expect(await callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30) }, fetchFn: fake })).toBe("新しいモデルの返事");
    expect(calls.some((c) => c.includes("gemini-3-flash:generateContent"))).toBe(true);
    // 次からは、見つけたモデルを、最初から使う
    calls.length = 0;
    await callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30) }, fetchFn: fake });
    expect(calls).toHaveLength(1); expect(calls[0]).toContain("gemini-3-flash:generateContent");
    // AI_MODEL を決めているときは、勝手に変えない
    resetGeminiModel();
    await expect(callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30), AI_MODEL: "gemini-2.5-flash" }, fetchFn: fake })).rejects.toThrow("宛先");
    resetGeminiModel();
  });
  it("AIの種類（flash／pro）を決められる。制作者だけ。proは、proのモデルを使う", async () => {
    await expect(svc.setAiTierSetting(d, u.office, "pro")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setAiTierSetting(d, u.owner, "ultra")).rejects.toThrow();
    await svc.setAiTierSetting(d, u.owner, "pro");
    expect((await svc.getAiSettings(d, u.owner)).tier).toBe("pro"); expect(getAiTier()).toBe("pro");
    const calls: string[] = [];
    const fake = (async (u2: string) => { calls.push(u2); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }); }) as unknown as typeof fetch;
    await callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30) }, fetchFn: fake });
    expect(calls[0]).toContain("gemini-2.5-pro:generateContent");
    await svc.setAiTierSetting(d, u.owner, "flash");
    expect(getAiTier()).toBe("flash");
  });
  it("モデル一覧が取れなくても、Googleの返事の「このモデルを使って」の名前に切りかえる", async () => {
    resetGeminiModel();
    const calls: string[] = [];
    const fake = (async (u: string) => {
      calls.push(u);
      if (u.includes("/models?pageSize")) return new Response("{}", { status: 403 });
      return u.includes("gemini-2.5-flash") ? new Response(JSON.stringify({ error: { status: "NOT_FOUND", message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features. We recommend" } }), { status: 404 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "返事" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30) }, fetchFn: fake })).toBe("返事");
    expect(calls.some((c) => c.includes("gemini-3.8-flash:generateContent"))).toBe(true);
    resetGeminiModel();
  });
  it("「AQ.」のカギで、入口1が404・入口2が403でも、モデルを切りかえる", async () => {
    resetGeminiModel();
    const calls: string[] = [];
    const fake = (async (u: string) => {
      calls.push(u);
      if (u.includes("aiplatform")) return new Response('{"error":{"status":"PERMISSION_DENIED","message":"disabled"}}', { status: 403 });
      if (u.includes("/models?pageSize")) return new Response("{}", { status: 403 });
      return u.includes("gemini-2.5-flash") ? new Response(JSON.stringify({ error: { message: "Please update your code to use models/gemini-3.8-flash for the latest" } }), { status: 404 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "返事" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await callAi("やあ", { env: { GEMINI_API_KEY: "AQ.Ab8" + "x".repeat(30) }, fetchFn: fake })).toBe("返事");
    expect(calls.some((c) => c.includes("generativelanguage") && c.includes("gemini-3.8-flash:generateContent"))).toBe(true);
    resetGeminiModel();
  });
  it("Googleが混んでいて503のときは、少し待って、もう一度送る", async () => {
    resetGeminiModel();
    let n = 0;
    const fake = (async () => (++n < 3 ? new Response('{"error":{"status":"UNAVAILABLE","message":"high demand"}}', { status: 503 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "やっと返事" }] } }] }), { status: 200 }))) as unknown as typeof fetch;
    expect(await callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30), AI_MODEL: "m" }, fetchFn: fake, retryDelayMs: 0 })).toBe("やっと返事");
    expect(n).toBe(3);
    n = -10;
    await expect(callAi("やあ", { env: { GEMINI_API_KEY: "AIza" + "x".repeat(30), AI_MODEL: "m" }, fetchFn: fake, retryDelayMs: 0 })).rejects.toThrow("混んでいます");
  });
});
