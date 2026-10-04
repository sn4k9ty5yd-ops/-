import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { asUser } from "../lib/db/user-context";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('x-co','X') returning id")).rows[0].id;
  for (const n of ["s1", "s2"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
  await mk("office", "1", 4, st.s1); await mk("mgr1", "2", 3, st.s1); await mk("staff1", "3", 1, st.s1); await mk("staff2", "4", 1, st.s2); await mk("maker", "5", 2, st.s1);
});

describe("期間と希望休のサービス", () => {
  it("期間を作れるのはオフィスだけ。作ると全店舗の進行状況が「準備中」で用意される", async () => {
    await expect(svc.createNextPeriod(db, id.mgr1, "2026-10-20")).rejects.toThrow(svc.ForbiddenError);
    await svc.createNextPeriod(db, id.office, "2026-10-20");
    const ps = await svc.listPeriods(db, id.office);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ label: "10/16〜11/15", start: "2026-10-16", end: "2026-11-15" });
    expect(ps[0].stores.map((s) => s.status)).toEqual(["preparing", "preparing"]);
  });
  it("2回目は続きの期間（11/16〜12/15）ができる", async () => {
    await svc.createNextPeriod(db, id.office, "2026-10-20");
    expect((await svc.listPeriods(db, id.office)).map((p) => p.label)).toEqual(["11/16〜12/15", "10/16〜11/15"]);
  });
  it("店長は自店の期間だけ見える/動かせる。スタッフは動かせない", async () => {
    const p = (await svc.listPeriods(db, id.office))[0];
    expect((await svc.listPeriods(db, id.staff2))[0].stores.map((s) => s.storeId)).toEqual([st.s2]);
    await svc.setPeriodStatus(db, id.mgr1, { periodId: p.id, storeId: st.s1, status: "collecting" });
    await expect(svc.setPeriodStatus(db, id.mgr1, { periodId: p.id, storeId: st.s2, status: "collecting" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setPeriodStatus(db, id.staff1, { periodId: p.id, storeId: st.s1, status: "closed" })).rejects.toThrow(svc.ForbiddenError);
  });
  it("希望休: 受付中の店舗のスタッフはオン/オフでき、受付前の店舗では変更できない", async () => {
    const p = (await svc.listPeriods(db, id.office))[0];
    expect(await svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-18")).toBe("added");
    expect((await svc.listRequests(db, id.staff1, p.id)).map((r) => r.day)).toEqual(["2026-11-18"]);
    expect(await svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-18")).toBe("removed");
    await expect(svc.toggleMyRequest(db, id.staff2, p.id, "2026-11-18")).rejects.toThrow("変更できません"); // s2は準備中
    await expect(svc.toggleMyRequest(db, id.staff1, p.id, "2027-01-01")).rejects.toThrow("変更できません"); // 期間外
  });
  it("締切にすると変更できない。他の人の希望休は店長には見え、同僚には見えない", async () => {
    const p = (await svc.listPeriods(db, id.office))[0];
    await svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-20");
    expect((await svc.listRequests(db, id.mgr1, p.id)).map((r) => r.membershipId)).toEqual([id.staff1]);
    expect(await svc.listRequests(db, id.staff2, p.id)).toEqual([]);
    await svc.setPeriodStatus(db, id.mgr1, { periodId: p.id, storeId: st.s1, status: "closed" });
    await expect(svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-21")).rejects.toThrow("変更できません");
    await expect(svc.toggleMyRequest(db, id.staff1, p.id, "2026-11-20")).rejects.toThrow("変更できません"); // 消すのも不可
  });
});

describe("お店の追加・名前変更・並べ替え・閉店", () => {
  it("お店を追加すると、すでにある期間にも自動で進行状況ができる", async () => {
    await svc.addStore(db, id.office, "新店舗");
    const p = (await svc.listPeriods(db, id.office))[0];
    const names = (await svc.listStores(db, id.office)).map((s) => s.name);
    expect(names).toContain("新店舗");
    expect(p.stores).toHaveLength(3);
  });
  it("名前変更・並べ替え・閉店はオフィスだけ", async () => {
    const stores = await svc.listStores(db, id.office);
    const nu = stores.find((s) => s.name === "新店舗")!;
    await expect(svc.renameStore(db, id.mgr1, nu.id, "勝手に改名")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.moveStore(db, id.mgr1, nu.id, "up")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStoreStatus(db, id.mgr1, nu.id, "closed")).rejects.toThrow(svc.ForbiddenError);
    await svc.renameStore(db, id.office, nu.id, "新店舗（改）");
    await svc.moveStore(db, id.office, nu.id, "up");
    const after = (await svc.listStores(db, id.office)).map((s) => s.name);
    expect(after.indexOf("新店舗（改）")).toBeLessThan(after.indexOf("s2"));
  });
  it("在籍スタッフがいるお店は閉店にできない。空なら閉店・再開できる", async () => {
    const stores = await svc.listStores(db, id.office);
    const s2 = stores.find((s) => s.name === "s2")!;
    await expect(svc.setStoreStatus(db, id.office, s2.id, "closed")).rejects.toThrow("在籍中のスタッフ");
    const nu = stores.find((s) => s.name === "新店舗（改）")!;
    await svc.setStoreStatus(db, id.office, nu.id, "closed");
    expect((await svc.listStores(db, id.office)).find((s) => s.id === nu.id)?.status).toBe("closed");
    await svc.setStoreStatus(db, id.office, nu.id, "active");
    expect((await svc.listStores(db, id.office)).find((s) => s.id === nu.id)?.status).toBe("active");
  });
  it("空の名前は登録できない", async () => {
    await expect(svc.addStore(db, id.office, "  ")).rejects.toThrow("名前を入力");
  });
});

describe("シフト担当（Lv2）の操作", () => {
  let d: Database; const u: Record<string, string> = {}; const s2: Record<string, string> = {};
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('y-co','Y') returning id")).rows[0].id;
    for (const n of ["a", "b"]) s2[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string) =>
      (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
    await mk("office", "1", 4, s2.a); await mk("maker", "2", 2, s2.a); await mk("staff", "3", 1, s2.a);
  });
  it("「次のシフトを作る」を押せる。先の期間がすでにあれば二重には作らない。スタッフは押せない", async () => {
    await expect(svc.ensureNextPeriod(d, u.staff, "2026-10-20")).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.ensureNextPeriod(d, u.maker, "2026-10-20")).toMatchObject({ created: true, label: "10/16〜11/15" });
    expect(await svc.ensureNextPeriod(d, u.maker, "2026-10-20")).toMatchObject({ created: true, label: "11/16〜12/15" });
    expect(await svc.ensureNextPeriod(d, u.maker, "2026-10-20")).toMatchObject({ created: false, label: "11/16〜12/15" });
    expect((await svc.listPeriods(d, u.office)).length).toBe(2);
  });
  it("自店のシフトを進められるが、他店は動かせない・確認済みにはできない", async () => {
    const p = (await svc.listPeriods(d, u.office))[0];
    await svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, status: "collecting" });
    await expect(svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.b, status: "collecting" })).rejects.toThrow(svc.ForbiddenError);
    for (const st of ["closed", "drafting", "confirmed", "published", "submitted"] as const) await svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, status: st });   // 公開もオフィスへの提出も、シフト担当が押せる
    await expect(svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, status: "acknowledged" })).rejects.toThrow();
    await svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, status: "published" });   // 押しまちがえたら、ひとつ戻せる
    await expect(svc.setPeriodStatus(d, u.staff, { periodId: p.id, storeId: s2.a, status: "confirmed" })).rejects.toThrow(svc.ForbiddenError);
    await svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, status: "submitted" });
    await svc.setPeriodStatus(d, u.office, { periodId: p.id, storeId: s2.a, status: "acknowledged" });
    await expect(svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, status: "submitted" })).rejects.toThrow();   // 確認済みから戻せるのはオフィスだけ
    await svc.setPeriodStatus(d, u.office, { periodId: p.id, storeId: s2.a, status: "submitted" });
    await svc.setAttendanceStatus(d, u.maker, p.id, s2.a, "submitted");
    await expect(svc.setAttendanceStatus(d, u.maker, p.id, s2.a, "acknowledged")).rejects.toThrow();
    await svc.setPeriodStatus(d, u.maker, { periodId: p.id, storeId: s2.a, closeAt: "2026-12-01T12:00:00+09:00" });   // 締切の日時も入れられる
  });
  it("アプリ制作者の印は、画面（アプリ用の接続）からは付けられない。管理者でも付かない", async () => {
    expect((await svc.getMe(d, u.office))?.appOwner).toBe(false);
    await expect(asUser(d, u.office, (q) => q.query("update memberships set app_owner = true where id = $1", [u.office]))).rejects.toThrow();
    await d.query("update memberships set app_owner = true where id = $1", [u.office]);   // 制作者の印はデータベースへ直接
    expect((await svc.getMe(d, u.office))?.appOwner).toBe(true);
    expect((await svc.getMe(d, u.maker))?.appOwner).toBe(false);
  });
  it("ご要望: だれでも送れる。見えるのは本人と制作者だけ。返事は制作者だけ。制作者にお知らせが届く", async () => {
    await svc.sendFeedback(d, u.staff, "もっと見やすくしてほしい");
    await svc.sendFeedback(d, u.maker, "別の要望");
    await expect(svc.sendFeedback(d, u.staff, "   ")).rejects.toThrow();
    expect((await svc.listFeedback(d, u.staff)).map((f) => f.body)).toEqual(["もっと見やすくしてほしい"]);
    expect((await svc.listFeedback(d, u.maker)).length).toBe(1);
    expect((await svc.listFeedback(d, u.office)).length).toBe(2);   // office は制作者の印を付けたアカウント
    const fid = (await svc.listFeedback(d, u.staff))[0].id;
    await expect(svc.updateFeedback(d, u.staff, fid, { status: "done" })).rejects.toThrow(svc.ForbiddenError);
    await svc.updateFeedback(d, u.office, fid, { status: "read", reply: "ありがとう！" });
    expect((await svc.listFeedback(d, u.staff))[0]).toMatchObject({ status: "read", reply: "ありがとう！" });
    const n = await d.query("select count(*)::int as n from notifications where user_id = $1 and kind = 'feedback'", [u.office]);
    expect(n.rows[0]).toEqual({ n: 2 });
  });
  it("アプリ制作者の行は、ほかのオフィスでも変えられない（退職・パスコード再発行・名前）", async () => {
    const co = (await d.query<{ company_id: string; store_id: string }>("select company_id, store_id from memberships where id = $1", [u.office])).rows[0];
    const o2 = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'99','office2',4) returning id", [co.company_id, co.store_id])).rows[0].id;
    await expect(svc.reissuePasscode(d, o2, u.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.disableStaff(d, o2, u.office)).rejects.toThrow();
    await expect(svc.updateStaffProfile(d, o2, u.office, { name: "のっとり" } as never)).rejects.toThrow();
    expect((await svc.listStaff(d, o2)).find((x) => x.id === u.office)?.manageable).toBe(false);
    expect(typeof (await svc.reissuePasscode(d, u.office, u.maker))).toBe("string");   // 制作者本人は、ほかの人を変えられる
  });
});

describe("レジ売上（月間スタッフ売上表）", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {};
  const row = (name: string, n = 0) => ({ name, techBefore: n, techDiscount: 0, techTax: 0, techTotal: n, goodsBefore: 0, goodsDiscount: 0, goodsTax: 0, goodsTotal: 0, allBefore: n, allDiscount: 0, allTax: 0, allTotal: n, newCount: 0, repeatCount: 0, fixedCount: 1, gobusataCount: 0, guestCount: 0, totalCount: 1 });
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('r-co','R') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string, name = k) =>
      (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
    await mk("office", "1", 4, sid.a); await mk("maker", "2", 2, sid.a); await mk("staffA", "3", 1, sid.a, "山田 太郎"); await mk("mgrB", "4", 3, sid.b); await mk("staffB", "5", 1, sid.b);
  });
  it("入れられるのは、シフト担当以上（自店）と事務員さん。スタッフ・他店は入れられない", async () => {
    await expect(svc.saveRegisterSales(d, u.staffA, sid.a, "2026-09", 28, [row("山田太郎", 100)])).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.saveRegisterSales(d, u.mgrB, sid.a, "2026-09", 28, [row("x", 1)])).rejects.toThrow();
    await svc.saveRegisterSales(d, u.maker, sid.a, "2026-09", 28, [row("山田太郎", 100), row("個室", 0)]);
    const g = await svc.getRegisterSales(d, u.maker, sid.a, "2026-09");
    expect(g).toMatchObject({ status: "entered", days: 28 });
    expect(g.rows).toHaveLength(2);
    expect(g.rows[0].membershipId).toBe(u.staffA);       // 名前（空白ぬき）が合う人にひもづく
    expect(g.rows[1].membershipId).toBeNull();
  });
  it("見られるのは、そのお店のシフト担当以上と事務員さんだけ。一般のスタッフ・他店の人（店長でも）は見えない", async () => {
    expect((await svc.getRegisterSales(d, u.staffA, sid.a, "2026-09")).rows).toHaveLength(0);   // 同じお店でも、一般のスタッフには見せない
    expect((await svc.getRegisterSales(d, u.maker, sid.a, "2026-09")).rows).toHaveLength(2);    // 同じお店のシフト担当
    expect((await svc.getRegisterSales(d, u.office, sid.a, "2026-09")).rows).toHaveLength(2);   // 事務員さん
    expect((await svc.getRegisterSales(d, u.mgrB, sid.a, "2026-09")).status).toBe("none");      // 他店の店長
    expect((await svc.getRegisterSales(d, u.staffB, sid.a, "2026-09")).rows).toHaveLength(0);   // 他店のスタッフ
  });
  it("事務員さんが確認する。確認済みのあとは直せない。もどせるのは事務員さんだけ。入れ直しは全部おきかわる", async () => {
    await expect(svc.confirmRegisterSales(d, u.maker, sid.a, "2026-09", true)).rejects.toThrow(svc.ForbiddenError);
    await svc.saveRegisterSales(d, u.maker, sid.a, "2026-09", 27, [row("山田太郎", 200)]);        // 入れ直し
    expect((await svc.getRegisterSales(d, u.maker, sid.a, "2026-09")).rows).toHaveLength(1);
    await svc.confirmRegisterSales(d, u.office, sid.a, "2026-09", true);
    expect((await svc.getRegisterSales(d, u.maker, sid.a, "2026-09")).status).toBe("confirmed");
    await expect(svc.saveRegisterSales(d, u.maker, sid.a, "2026-09", 27, [row("山田太郎", 300)])).rejects.toThrow("確認済み");
    await expect(svc.confirmRegisterSales(d, u.maker, sid.a, "2026-09", false)).rejects.toThrow(svc.ForbiddenError);
    await svc.confirmRegisterSales(d, u.office, sid.a, "2026-09", false);
    await svc.saveRegisterSales(d, u.maker, sid.a, "2026-09", 27, [row("山田太郎", 300)]);
    expect((await svc.getRegisterSales(d, u.office, sid.a, "2026-09")).rows[0].allTotal).toBe(300);
  });
  it("事務員さんに知らせが届く", async () => {
    const n = await d.query("select count(*)::int as n from notifications where user_id = $1 and kind = 'register'", [u.office]);
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe("商品の追加・このお店で使わない・全体から消す", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {};
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('p-co','P') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string) =>
      (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id);
    await mk("office", "1", 4, sid.a); await mk("mgrA", "2", 3, sid.a); await mk("mgrB", "3", 3, sid.b); await mk("maker", "4", 2, sid.a);
  });
  it("追加できるのは店長以上。追加した商品は、えらんだお店（全店）の一覧に入る。同じ商品は飛ばす", async () => {
    await expect(svc.createProducts(d, u.maker, "retail", [{ name: "シャンプー", costPrice: 1000 }], [sid.a])).rejects.toThrow(svc.ForbiddenError);
    const r = await svc.createProducts(d, u.mgrA, "retail", [{ maker: "ミルボン", name: "シャンプー", spec: "500ml", costPrice: 1200 }, { name: "トリートメント", costPrice: 900 }], [sid.a, sid.b]);
    expect(r).toEqual({ created: 2, skipped: 0 });
    expect(await svc.createProducts(d, u.mgrB, "retail", [{ maker: "ミルボン", name: "シャンプー", spec: "500ml", costPrice: 1200 }], [sid.a])).toEqual({ created: 0, skipped: 1 });
    const list = await svc.listProducts(d, u.mgrB, "retail");
    expect(list).toHaveLength(2);
    expect(list.every((p) => p.storeIds.length === 2)).toBe(true);
    await expect(svc.createProducts(d, u.mgrA, "retail", [{ name: "x", costPrice: 1 }], [])).rejects.toThrow();
  });
  it("このお店で使わない: 店長は自店だけ。事務員さんは全店。商品は消えない。また使うで戻せる", async () => {
    const p = (await svc.listProducts(d, u.office, "retail")).find((x) => x.name === "シャンプー")!;
    await expect(svc.setProductStoreUse(d, u.mgrA, p.id, sid.b, false)).rejects.toThrow(svc.ForbiddenError);   // 他店は不可
    await expect(svc.setProductStoreUse(d, u.maker, p.id, sid.a, false)).rejects.toThrow(svc.ForbiddenError);  // シフト担当は不可
    await svc.setProductStoreUse(d, u.mgrA, p.id, sid.a, false);
    let now = (await svc.listProducts(d, u.office, "retail")).find((x) => x.id === p.id)!;
    expect(now.storeIds).toEqual([sid.b]);                      // Aだけ外れた。Bはそのまま
    expect(now.status).toBe("active");
    await svc.setProductStoreUse(d, u.mgrA, p.id, sid.a, true);
    now = (await svc.listProducts(d, u.office, "retail")).find((x) => x.id === p.id)!;
    expect(now.storeIds.sort()).toEqual([sid.a, sid.b].sort());
    await svc.setProductStoreUse(d, u.office, p.id, sid.b, false);   // 事務員さんは他店もできる
  });
  it("全体から消す（取扱い終了）・再開は、事務員さんだけ", async () => {
    const p = (await svc.listProducts(d, u.office, "retail")).find((x) => x.name === "トリートメント")!;
    await expect(svc.setProductStatus(d, u.mgrA, p.id, "discontinued")).rejects.toThrow(svc.ForbiddenError);
    await svc.setProductStatus(d, u.office, p.id, "discontinued");
    expect((await svc.listProducts(d, u.office, "retail")).find((x) => x.id === p.id)!.status).toBe("discontinued");
    await svc.setProductStatus(d, u.office, p.id, "active");
    expect((await svc.listProducts(d, u.office, "retail")).find((x) => x.id === p.id)!.status).toBe("active");
  });
});

describe("レッスンチェック表（採点）", () => {
  let d: Database; const u: Record<string, string> = {}; const sid: Record<string, string> = {}; let sheetId = ""; let items: string[] = [];
  beforeAll(async () => {
    d = await newDb(); await migrate(d);
    const co = (await d.query<{ id: string }>("insert into companies (code, name) values ('c-co','C') returning id")).rows[0].id;
    for (const n of ["a", "b"]) sid[n] = (await d.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
    const mk = async (k: string, code: string, level: number, s: string, extra = "") =>
      (u[k] = (await d.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, k, level])).rows[0].id, extra && await d.query(`update memberships set ${extra} where id = $1`, [u[k]]));
    await mk("office", "1", 4, sid.a); await mk("mgrA", "2", 3, sid.a); await mk("edu", "3", 1, sid.a, "edu_lead = true"); await mk("evalr", "4", 1, sid.a, "can_evaluate = true");
    await mk("traineeA", "5", 1, sid.a, "rank = 'assistant'"); await mk("plainA", "6", 1, sid.a); await mk("traineeB", "7", 1, sid.b, "rank = 'assistant'"); await mk("mgrB", "8", 3, sid.b);
  });
  it("表を直せるのは、事務員さんと教育担当だけ。店長でも不可", async () => {
    const input = { grade: "1年目", name: "シャンプー", memo: "", maxPoints: 15, passPoints: 12, maxAttempts: 10, active: true, items: [{ name: "声掛け" }, { name: "力加減" }, { name: "すすぎ" }] };
    await expect(svc.saveCheckSheet(d, u.mgrA, input)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.saveCheckSheet(d, u.plainA, input)).rejects.toThrow(svc.ForbiddenError);
    sheetId = await svc.saveCheckSheet(d, u.edu, input);
    const cur = (await svc.getCheckData(d, u.traineeA)).sheets[0].items.map((i) => ({ id: i.id, name: i.name }));
    expect(await svc.saveCheckSheet(d, u.office, { ...input, id: sheetId, memo: "メモ", items: cur })).toBe(sheetId);
    const data = await svc.getCheckData(d, u.traineeA);
    expect(data.sheets).toHaveLength(1);
    items = data.sheets[0].items.map((i) => i.id);
    expect(items).toHaveLength(3);
    expect(data.sheets[0]).toMatchObject({ memo: "メモ", passPoints: 12 });
    await expect(svc.saveCheckSheet(d, u.office, { ...input, passPoints: 99 })).rejects.toThrow();   // 合格点が満点より大きい
  });
  it("採点できるのは、自店の店長・教育担当・技術評価をつけられる人と事務員さん。本人・ふつうのスタッフ・他店は不可", async () => {
    const sc = (a: number, b: number, c: number) => [{ itemId: items[0], score: a }, { itemId: items[1], score: b }, { itemId: items[2], score: c }];
    const base = { sheetId, traineeId: u.traineeA, attemptNo: 1, time: "4:30", comment: "よい", scores: sc(5, 4, 4) };
    await expect(svc.saveCheckAttempt(d, u.plainA, base)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.saveCheckAttempt(d, u.mgrB, base)).rejects.toThrow(svc.ForbiddenError);       // 他店の店長
    await expect(svc.saveCheckAttempt(d, u.traineeA, base)).rejects.toThrow();                      // 自分
    expect(await svc.saveCheckAttempt(d, u.mgrA, base)).toEqual({ total: 13, passed: true });       // 13点 ≥ 合格12点
    expect(await svc.saveCheckAttempt(d, u.evalr, { ...base, attemptNo: 2, scores: sc(1, 1, 1) })).toEqual({ total: 3, passed: false });
    await svc.saveCheckAttempt(d, u.edu, { ...base, attemptNo: 3, scores: sc(3, 3, 3) });
    await expect(svc.saveCheckAttempt(d, u.mgrA, { ...base, scores: sc(6, 0, 0) })).rejects.toThrow();   // 点数は0〜5
    await expect(svc.saveCheckAttempt(d, u.mgrA, { ...base, attemptNo: 11 })).rejects.toThrow();         // 回数オーバー
  });
  it("見られるのは、本人と、採点できる人。他店・ふつうのスタッフには見えない。同じ回の入れ直しは、おきかわる", async () => {
    const mine = await svc.getCheckData(d, u.traineeA);
    expect(mine.trainee?.id).toBe(u.traineeA);
    expect(mine.attempts.map((a) => [a.attemptNo, a.total])).toEqual([[1, 13], [2, 3], [3, 9]]);
    expect(mine.attempts[0]).toMatchObject({ assessorName: "mgrA", time: "4:30" });
    expect(mine.canAssess).toBe(false);
    expect((await svc.getCheckData(d, u.mgrA, u.traineeA)).canAssess).toBe(true);
    expect((await svc.getCheckData(d, u.mgrA, u.traineeA)).trainees.map((t) => t.name)).not.toContain("traineeB");   // 自店だけ
    expect((await svc.getCheckData(d, u.office, u.traineeB)).trainee?.id).toBe(u.traineeB);                             // 事務員さんは全店
    expect((await svc.getCheckData(d, u.mgrB, u.traineeA)).trainee).toBeNull();                                         // 他店は見えない
    expect((await svc.getCheckData(d, u.plainA, u.traineeA)).trainee).toBeNull();                                       // ふつうのスタッフは、人のを見られない
    await svc.saveCheckAttempt(d, u.mgrA, { sheetId, traineeId: u.traineeA, attemptNo: 2, scores: [{ itemId: items[0], score: 5 }, { itemId: items[1], score: 5 }, { itemId: items[2], score: 5 }] });
    expect((await svc.getCheckData(d, u.traineeA)).attempts.find((a) => a.attemptNo === 2)?.total).toBe(15);
  });
  it("採点を取り消せる（採点できる人）。本人には、採点のお知らせが届く", async () => {
    const a3 = (await svc.getCheckData(d, u.traineeA)).attempts.find((a) => a.attemptNo === 3)!;
    await expect(svc.deleteCheckAttempt(d, u.plainA, a3.id)).rejects.toThrow(svc.ForbiddenError);
    await svc.deleteCheckAttempt(d, u.mgrA, a3.id);
    expect((await svc.getCheckData(d, u.traineeA)).attempts.map((a) => a.attemptNo)).toEqual([1, 2]);
    const n = await d.query("select count(*)::int as n from notifications where user_id = $1 and kind = 'lesson'", [u.traineeA]);
    expect(n.rows[0].n).toBeGreaterThanOrEqual(3);
  });
});
