import { beforeAll, describe, expect, it } from "vitest";
import { login, validateSession } from "../lib/auth/login";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const store: Record<string, string> = {};

async function person(co: string, code: string, name: string, level: number, st: string) {
  const r = await db.query<{ id: string }>(
    "insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, st, code, name, level]);
  return r.rows[0].id;
}

beforeAll(async () => {
  db = await newDb();
  expect(await migrate(db)).toEqual(["0001_tenant_core.sql", "0002_periods_requests.sql", "0003_store_changes.sql", "0004_shifts.sql", "0005_break_rule.sql", "0006_attendance.sql", "0007_products_stocktake.sql", "0008_stock.sql", "0009_display_accounts.sql", "0010_presence.sql", "0011_saturday_hours.sql", "0012_scheduled_retirement.sql", "0013_manual.sql", "0014_ranks.sql", "0015_short_name.sql", "0016_day_limits.sql", "0017_material_orders.sql", "0018_material_tax.sql", "0019_material_manager.sql", "0020_push.sql", "0021_lessons.sql", "0022_lesson_subcategories.sql", "0023_paid_leave.sql", "0024_sales.sql", "0025_sales_flow.sql", "0026_sales_commission.sql", "0027_security.sql", "0028_shift_maker_perms.sql", "0029_app_owner.sql", "0030_feedback.sql", "0031_undo_step.sql", "0032_acknowledge_owner.sql", "0033_register_sales.sql", "0034_product_add_store_use.sql", "0035_register_staff_hidden.sql", "0036_stocktake_everyone.sql", "0037_stocktake_everyone_manage.sql", "0038_lesson_checks.sql", "0039_check_max_from_items.sql", "0040_drop_register_sales.sql", "0041_wipe_sales.sql", "0042_sales_own_only.sql", "0043_manager_own_store_shifts.sql", "0044_tester_staffbuy.sql", "0045_rename_tester.sql", "0046_check_stylists.sql", "0047_exec_tiers.sql", "0048_meetings.sql", "0049_activity_log.sql", "0050_mentor.sql", "0052_interview_edit.sql", "0053_mbti_directory.sql", "0054_remove_empty_interview_pages.sql", "0055_shift_break.sql", "0056_app_secrets.sql", "0057_shift_edit_after_publish.sql", "0058_product_add_everyone.sql", "0059_mbti_own_store.sql", "0060_mbti_all_for_exec.sql", "0061_view_as.sql", "0062_leave_anytime.sql", "0063_office_inbox.sql", "0064_stocktake_line_edit.sql", "0065_close_time_reminder.sql", "0066_request_stage_visible.sql", "0067_check_assessor_pick.sql", "0068_commute_pass.sql", "0069_limits_by_rank.sql", "0070_commute_months.sql", "0071_material_manager_own_store.sql", "0072_fortune_push.sql", "0073_ai_councils.sql", "0074_material_dealers.sql", "0075_material_default_categories.sql", "0076_remove_shampoo_category.sql", "0077_material_main_dealers_misc.sql", "0078_spa_claims.sql"]);
  expect(await migrate(db)).toEqual([]); // 2回目は何もしない
  const a = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-a','A社') returning id")).rows[0].id;
  const b = (await db.query<{ id: string }>("insert into companies (code, name) values ('co-b','B社') returning id")).rows[0].id;
  for (const [k, co, n] of [["a1", a, "A店1"], ["a2", a, "A店2"], ["b1", b, "B店1"]] as const)
    store[k] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  id.office = await person(a, "9000", "オフィス", 4, store.a1);
  id.mgr = await person(a, "1001", "店長", 3, store.a1);
  id.shift = await person(a, "1002", "シフト担当", 2, store.a1);
  id.staff = await person(a, "1003", "スタッフ", 1, store.a1);
  id.staff2 = await person(a, "2003", "他店スタッフ", 1, store.a2);
  id.officeB = await person(b, "9000", "B社オフィス", 4, store.b1);
});

describe("サービス層（DBの権限ルールを通して動く）", () => {
  it("店長は自店のスタッフを登録でき、パスコードが発行されて、その人がログインできる", async () => {
    const r = await svc.addStaff(db, id.mgr, { name: "新人", employeeCode: "1100", storeId: store.a1, level: 1 });
    expect(r.passcode).toMatch(/^\d{6}$/);
    const l = await login(db, { companyCode: "co-a", employeeCode: "1100", passcode: r.passcode });
    expect(l.ok).toBe(true);
    if (l.ok) expect(await validateSession(db, l.token)).toBe(r.id);
  });
  it("店長は他店への登録・レベル付き登録ができない", async () => {
    await expect(svc.addStaff(db, id.mgr, { name: "x", employeeCode: "1200", storeId: store.a2, level: 1 })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addStaff(db, id.mgr, { name: "x", employeeCode: "1201", storeId: store.a1, level: 4 })).rejects.toThrow(svc.ForbiddenError);
  });
  it("他社の店舗には、オフィスでも登録できない", async () => {
    await expect(svc.addStaff(db, id.office, { name: "x", employeeCode: "1300", storeId: store.b1, level: 1 })).rejects.toThrow(svc.ForbiddenError);
  });
  it("社員番号は会社の中で重複できない（別会社なら同じ番号OK）", async () => {
    await expect(svc.addStaff(db, id.office, { name: "x", employeeCode: "1003", storeId: store.a1, level: 1 })).rejects.toThrow("すでに使われて");
    await expect(svc.addStaff(db, id.officeB, { name: "別会社の1003", employeeCode: "1003", storeId: store.b1, level: 1 })).resolves.toBeTruthy();
  });
  it("パスコード再発行: 店長は自店スタッフのみ。オフィスや他店は不可。旧パスコードは使えなくなる", async () => {
    const pc = await svc.reissuePasscode(db, id.mgr, id.staff);
    expect((await login(db, { companyCode: "co-a", employeeCode: "1003", passcode: pc })).ok).toBe(true);
    await expect(svc.reissuePasscode(db, id.mgr, id.office)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reissuePasscode(db, id.mgr, id.staff2)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reissuePasscode(db, id.staff, id.staff)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.reissuePasscode(db, id.office, id.officeB)).rejects.toThrow(svc.ForbiddenError); // 他社
  });
  it("退職にすると、ログイン中のセッションも消える。自分自身は退職にできない", async () => {
    const pc = await svc.reissuePasscode(db, id.office, id.shift);
    const l = await login(db, { companyCode: "co-a", employeeCode: "1002", passcode: pc });
    if (!l.ok) throw new Error("login");
    await svc.disableStaff(db, id.mgr, id.shift);
    expect(await validateSession(db, l.token)).toBeNull();
    await expect(svc.disableStaff(db, id.office, id.office)).rejects.toThrow("ほかに有効な管理者");
    await expect(svc.disableStaff(db, id.mgr, id.office)).rejects.toThrow(svc.ForbiddenError);
  });
  it("レベル変更はオフィスだけ。自分のレベルは変えられない", async () => {
    await expect(svc.setStaffLevel(db, id.mgr, id.staff, 2)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setStaffLevel(db, id.office, id.office, 1)).rejects.toThrow(svc.ForbiddenError);
    await svc.setStaffLevel(db, id.office, id.staff, 2);
    expect((await svc.getMe(db, id.staff))?.level).toBe(2);
    await expect(svc.setStaffLevel(db, id.office, id.officeB, 1)).rejects.toThrow(svc.ForbiddenError); // 他社
  });
  it("一覧は自分の権限の範囲だけ。他社は見えない", async () => {
    expect((await svc.listStaff(db, id.staff2)).map((s) => s.name)).toEqual(["他店スタッフ"]);
    const all = (await svc.listStaff(db, id.office)).map((s) => s.name);
    expect(all).toContain("他店スタッフ");
    expect(all).not.toContain("B社オフィス");
    expect((await svc.listStores(db, id.mgr)).map((s) => s.name).sort()).toEqual(["A店1", "A店2"]);
    expect(await svc.listStores(db, id.staff2)).toHaveLength(1);
  });
  it("店の追加はオフィスだけ", async () => {
    await expect(svc.addStore(db, id.mgr, "新店")).rejects.toThrow(svc.ForbiddenError);
    await svc.addStore(db, id.office, "新店");
    expect((await svc.listStores(db, id.office)).map((s) => s.name)).toContain("新店");
  });
  it("パスコードのハッシュは一覧に出てこない", async () => {
    const rows = await svc.listStaff(db, id.office);
    expect(JSON.stringify(rows)).not.toMatch(/scrypt|passcode/);
  });
});

describe("退職者の社員番号を空ける", () => {
  it("管理者だけが、退職した人の番号を空けて、新しい人が同じ番号を使える", async () => {
    const old = await person((await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id, "2200", "退職予定", 1, store.a1);
    await expect(svc.releaseRetiredCode(db, id.office, old)).rejects.toThrow("退職");
    await svc.disableStaff(db, id.office, old);
    await expect(svc.releaseRetiredCode(db, id.mgr, old)).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.releaseRetiredCode(db, id.office, old)).toBe("2200");
    const r = await svc.addStaff(db, id.office, { name: "新しい人", employeeCode: "2200", storeId: store.a1, level: 1 });
    expect(r.passcode).toMatch(/^\d{6}$/);
    await expect(svc.releaseRetiredCode(db, id.office, old)).rejects.toThrow("すでに");
  });
});

describe("ログイン状況と並び順（管理者のみ）", () => {
  it("社員番号の小さい順に並び、管理者だけがログイン状況を見られる", async () => {
    const co = (await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id;
    const p = await svc.addStaff(db, id.office, { name: "状況テスト", employeeCode: "5500", storeId: store.a1, level: 1 });
    const codes = (await svc.listStaff(db, id.office)).map((s) => s.employeeCode);
    const nums = codes.filter((c) => /^\d+$/.test(c)).map(Number);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    let row = (await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!;
    expect(row.presence).toBe("never");
    const l = await login(db, { companyCode: "co-a", employeeCode: "5500", passcode: p.passcode });
    expect(l.ok).toBe(true);
    row = (await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!;
    expect(row.presence).toBe("online");
    await db.query("update memberships set last_seen_at = now() - interval '10 minutes' where id=$1", [p.id]);
    expect((await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!.presence).toBe("idle");
    await db.query("delete from sessions where membership_id=$1", [p.id]);
    expect((await svc.listStaff(db, id.office)).find((s) => s.id === p.id)!.presence).toBe("loggedout");
    expect((await svc.listStaff(db, id.mgr)).every((s) => s.presence === undefined)).toBe(true);
    void co;
  });
});

describe("名前・社員番号の変更（管理者のみ）", () => {
  it("管理者は自分も含めて名前・番号を変えられ、重複は断られ、店長はできない", async () => {
    await svc.updateStaffProfile(db, id.office, id.office, { name: "成田和樹", employeeCode: "6" });
    const me = (await svc.listStaff(db, id.office)).find((s) => s.id === id.office)!;
    expect(me).toMatchObject({ name: "成田和樹", employeeCode: "6" });
    await expect(svc.updateStaffProfile(db, id.office, id.staff, { employeeCode: "6" })).rejects.toThrow("すでに");
    await expect(svc.updateStaffProfile(db, id.mgr, id.staff, { name: "x" })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.updateStaffProfile(db, id.office, id.staff, { employeeCode: "あ" })).rejects.toThrow("英数字");
  });
});

describe("土曜日だけ違う営業時間", () => {
  it("お店ごとに土曜の営業時間を設定でき、曜日ごとの時間が切りかわる", async () => {
    await svc.setStoreHours(db, id.office, store.a1, "10:00", "19:00", { open: "10:00", close: "20:00" });
    const st = (await svc.listStores(db, id.office)).find((s) => s.id === store.a1)!;
    expect(st).toMatchObject({ satOpen: "10:00", satClose: "20:00" });
    const { hoursOn } = await import("../lib/labels");
    expect(hoursOn(st, "2026-10-17")).toEqual({ start: "10:00", end: "20:00" }); // 土
    expect(hoursOn(st, "2026-10-16")).toEqual({ start: "10:00", end: "19:00" }); // 金
    await expect(svc.setStoreHours(db, id.mgr, store.a1, "10:00", "19:00", null)).rejects.toThrow(svc.ForbiddenError);
    await svc.setStoreHours(db, id.office, store.a1, "10:00", "19:00", null);
    expect((await svc.listStores(db, id.office)).find((s) => s.id === store.a1)!.satOpen).toBeNull();
  });
});

describe("管理者も、ほかのスタッフと同じように扱える", () => {
  it("自分をシフトに入れる／外せる。ほかに管理者がいれば自分を退職にもできる", async () => {
    await svc.setOnShift(db, id.office, id.office, true);
    expect((await svc.listStaff(db, id.office)).find((x) => x.id === id.office)!.onShift).toBe(true);
    await svc.setOnShift(db, id.office, id.office, false);
    expect((await svc.listStaff(db, id.office)).find((x) => x.id === id.office)!.onShift).toBe(false);
    const co = (await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id;
    const admin2 = await person(co, "9001", "管理者2", 4, store.a1);
    await svc.disableStaff(db, admin2, admin2);
    expect((await svc.listStaff(db, id.office)).find((x) => x.id === admin2)!.status).toBe("disabled");
  });
});

describe("退職予定日", () => {
  it("予定日の前は使え、予定日になると自動で退職になりログインできなくなる。最後の管理者は対象外", async () => {
    const co = (await db.query<{ company_id: string }>("select company_id from memberships where id=$1", [id.office])).rows[0].company_id;
    const p = await svc.addStaff(db, id.office, { name: "予定の人", employeeCode: "6600", storeId: store.a1, level: 1 });
    await expect(svc.setRetireDate(db, id.mgr, p.id, "2099-01-01")).rejects.toThrow(svc.ForbiddenError);
    await svc.setRetireDate(db, id.office, p.id, "2099-01-01");
    expect((await svc.listStaff(db, id.office)).find((s) => s.id === p.id)).toMatchObject({ status: "active", retireOn: "2099-01-01" });
    expect((await login(db, { companyCode: "co-a", employeeCode: "6600", passcode: p.passcode })).ok).toBe(true);
    await svc.setRetireDate(db, id.office, p.id, "2000-01-01"); // 過去の日付＝今日が過ぎている
    expect((await login(db, { companyCode: "co-a", employeeCode: "6600", passcode: p.passcode })).ok).toBe(false);
    expect((await svc.listStaff(db, id.office)).find((s) => s.id === p.id)).toMatchObject({ status: "disabled" });
    await expect(svc.setRetireDate(db, id.office, id.office, "2000-01-01")).rejects.toThrow("ほかに有効な管理者"); // 最後の管理者は決められない
    void co;
  });
});

describe("希望休を公休／有給で出す", () => {
  it("同じ日を出し直すと種類が変わり、取り消せる。短い名前は自動で決まり、同じ苗字は区別される", async () => {
    const { shortNames } = await import("../lib/labels");
    const m = shortNames([
      { id: "1", name: "金子直樹" }, { id: "2", name: "金子嵩史" }, { id: "3", name: "永尾和徳" }, { id: "4", name: "山口 遥" }, { id: "5", name: "廣茉紀", shortName: "廣" },
    ]);
    expect([...m.values()]).toEqual(["金子直", "金子嵩", "永尾", "山口", "廣"]);
    await expect(svc.setMyRequest(db, id.staff, "00000000-0000-0000-0000-000000000000", "2026-11-18", "hope")).rejects.toThrow("いまは希望休を変更できません");
  });
});

describe("材料費（発注額）", () => {
  const inp = { orderedOn: "2026-10-05", supplier: "○○商事", item: "カラー剤", kind: "supply" as const, amount: 12800 };
  it("同じお店のスタッフ(Lv1)も記入でき、同じお店の人は見られる。記入した人が自動で残る", async () => {
    const oid = await svc.addMaterialOrder(db, id.staff, store.a1, inp);
    const rows = await svc.listMaterialOrders(db, id.mgr, store.a1, "2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 12800, by: "スタッフ", deleted: false });
    expect(await svc.listMaterialSuppliers(db, id.staff, store.a1)).toEqual(["○○商事"]);
    await svc.updateMaterialOrder(db, id.mgr, oid, { ...inp, amount: 13000 });
    expect((await svc.listMaterialOrders(db, id.staff, store.a1, "2026-10-01", "2026-10-31"))[0]).toMatchObject({ amount: 13000, edited: true });
  });
  it("他のお店のスタッフは見られず・書けない。店長も他店は見えない。オフィスは全店", async () => {
    expect(await svc.listMaterialOrders(db, id.staff2, store.a1, "2026-10-01", "2026-10-31")).toHaveLength(0);
    await expect(svc.addMaterialOrder(db, id.staff2, store.a1, inp)).rejects.toThrow(svc.ForbiddenError);
    expect(await svc.listMaterialOrders(db, id.mgr, store.a2, "2026-10-01", "2026-10-31")).toHaveLength(0);
    await expect(svc.addMaterialOrder(db, id.mgr, store.a2, inp)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addMaterialOrder(db, id.office, store.a2, inp)).resolves.toBeTruthy();
    expect(await svc.listMaterialOrders(db, id.mgr, store.a2, "2026-10-01", "2026-10-31")).toHaveLength(0);   // 店長も、他店は見えない
  });
  it("金額の入力チェック", async () => {
    await expect(svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, amount: -1 })).rejects.toThrow("金額");
    await expect(svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, supplier: " " })).rejects.toThrow("発注先");
  });
  it("取り消しは消さずに残り、スタッフからは見えなくなり、店長は記録を見られる", async () => {
    const oid = await svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, amount: 500 });
    await svc.cancelMaterialOrder(db, id.staff, oid);
    const staffView = await svc.listMaterialOrders(db, id.staff, store.a1, "2026-10-01", "2026-10-31");
    expect(staffView.some((o) => o.id === oid)).toBe(false);
    const mgrView = await svc.listMaterialOrders(db, id.mgr, store.a1, "2026-10-01", "2026-10-31");
    expect(mgrView.find((o) => o.id === oid)?.deleted).toBe(true);
    const log = await svc.listMaterialLog(db, id.mgr, store.a1);
    expect(log.filter((l) => l.orderId === oid).map((l) => l.action).sort()).toEqual(["取り消し", "追加"]);
    await expect(svc.listMaterialLog(db, id.staff, store.a1)).resolves.toHaveLength(0);
    await expect(svc.cancelMaterialOrder(db, id.staff2, oid)).rejects.toThrow(svc.ForbiddenError);
  });
  it("予算は店長(自店)・管理者だけ決められる", async () => {
    await svc.setMaterialBudget(db, id.mgr, store.a1, "2026-10-01", 300000);
    expect(await svc.getMaterialBudget(db, id.staff, store.a1, "2026-10-01")).toBe(300000);
    await expect(svc.setMaterialBudget(db, id.staff, store.a1, "2026-10-01", 1)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setMaterialBudget(db, id.mgr, store.a2, "2026-10-01", 1)).rejects.toThrow(svc.ForbiddenError);
  });
  it("スクリーンショットを付けると、貼った人と日時が自動で残る。他店は見られない", async () => {
    const oid = await svc.addMaterialOrder(db, id.staff, store.a1, inp);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const iid = await svc.addMaterialImage(db, id.staff, oid, "image/png", png);
    const imgs = await svc.listMaterialImages(db, id.mgr, store.a1, "2026-10-01", "2026-10-31");
    expect(imgs.find((i) => i.id === iid)).toMatchObject({ orderId: oid, by: "スタッフ" });
    expect((await svc.getMaterialImage(db, id.mgr, iid))?.data.equals(png)).toBe(true);
    expect(await svc.getMaterialImage(db, id.staff2, iid)).toBeNull();
    await expect(svc.addMaterialImage(db, id.staff2, oid, "image/png", png)).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.addMaterialImage(db, id.staff, oid, "text/html", png)).rejects.toThrow("画像");
  });
  it("明細（商品名・数量・金額）を保存でき、直すと記録に残る。不正な明細は断る", async () => {
    const lines = [{ name: "シャンプー", qty: 2, amount: 7600 }, { name: "カラー剤", qty: 12, amount: 14400 }];
    const oid = await svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, amount: 22000, lines });
    expect((await svc.listMaterialOrders(db, id.staff, store.a1, "2026-10-01", "2026-10-31")).find((o) => o.id === oid)?.lines).toEqual(lines);
    await svc.updateMaterialOrder(db, id.staff, oid, { ...inp, amount: 7600, lines: [lines[0]] });
    expect((await svc.listMaterialOrders(db, id.staff, store.a1, "2026-10-01", "2026-10-31")).find((o) => o.id === oid)?.lines).toHaveLength(1);
    const log = await svc.listMaterialLog(db, id.mgr, store.a1);
    expect(log.some((l) => l.orderId === oid && l.action === "変更")).toBe(true);
    await expect(svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, lines: [{ name: "", qty: 1, amount: 1 }] })).rejects.toThrow("明細");
  });
  it("税込で入れると税抜に直して保存され、入力した金額も残る。税の入れ方・商品名・読み間違いの直しは覚えられる", async () => {
    const oid = await svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, supplier: "学習商事", amount: 11000, taxMode: "in",
      lines: [{ name: "シャンプー", qty: 1, amount: 5500, raw: "シャンプ一" }, { name: "カラー剤", qty: 1, amount: 5500, raw: "カラー剤" }] });
    const o = (await svc.listMaterialOrders(db, id.staff, store.a1, "2026-10-01", "2026-10-31")).find((x) => x.id === oid)!;
    expect(o).toMatchObject({ amount: 10000, taxMode: "in", entered: 11000 });
    expect(o.lines).toEqual([{ name: "シャンプー", qty: 1, amount: 5000, raw: "シャンプ一" }, { name: "カラー剤", qty: 1, amount: 5000 }]);
    const mem = await svc.getMaterialMemory(db, id.staff, store.a1);
    expect(mem.supplierTax["学習商事"]).toBe("in");
    expect(mem.suppliers).toContain("学習商事");
    expect(mem.items).toEqual(expect.arrayContaining(["シャンプー", "カラー剤"]));
    expect(mem.aliases).toContainEqual({ raw: "シャンプ一", name: "シャンプー" });
    expect(mem.frequent).toContainEqual({ name: "シャンプー", supplier: "学習商事", category: "", unit: 5000, count: 1 });
    expect((await svc.getMaterialMemory(db, id.staff2, store.a1)).items).toEqual([]);   // 他店の人には見えない
  });
  it("材料担当: 自分の登録店舗の材料費だけ、統括・記録まで見られる。他店は見えない（全店は正美さん以上だけ）", async () => {
    await expect(svc.materialSummaryData(db, id.staff, "2026-01-01", "2026-12-31")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.materialSummaryData(db, id.mgr, "2026-01-01", "2026-12-31")).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.setMaterialManager(db, id.mgr, id.staff2, true)).rejects.toThrow(svc.ForbiddenError);   // 管理者だけが決められる
    const before = await svc.materialSummaryData(db, id.office, "2026-01-01", "2026-12-31");
    expect(before.orders.some((o) => o.storeId === store.a1) && before.orders.some((o) => o.storeId === store.a2)).toBe(true);
    await svc.setMaterialManager(db, id.office, id.staff2, true);   // staff2 は他店の人
    try {
      expect((await svc.getMe(db, id.staff2))?.materialManager).toBe(true);
      expect(await svc.listMaterialOrders(db, id.staff2, store.a1, "2026-10-01", "2026-10-31")).toHaveLength(0);   // 他店は見えない
      await expect(svc.addMaterialOrder(db, id.staff2, store.a1, inp)).rejects.toThrow(svc.ForbiddenError);
      const mine = await svc.materialSummaryData(db, id.staff2, "2026-01-01", "2026-12-31");
      expect(mine.orders.some((o) => o.storeId === store.a1)).toBe(false);   // 自分のお店（a2）の分だけ
    } finally { await svc.setMaterialManager(db, id.office, id.staff2, false); }
    await svc.setMaterialManager(db, id.office, id.staff, true);   // staff は a1 の人
    try {
      expect((await svc.listMaterialOrders(db, id.staff, store.a1, "2026-10-01", "2026-10-31")).length).toBeGreaterThan(0);
      const all = await svc.materialSummaryData(db, id.staff, "2026-01-01", "2026-12-31");
      expect(all.orders.some((o) => o.storeId === store.a1)).toBe(true);
      expect(all.orders.some((o) => o.storeId === store.a2)).toBe(false);   // 他店は入らない
      expect((await svc.listMaterialLog(db, id.staff, store.a1)).length).toBeGreaterThan(0);
    } finally { await svc.setMaterialManager(db, id.office, id.staff, false); }
    await expect(svc.materialSummaryData(db, id.staff2, "2026-01-01", "2026-12-31")).rejects.toThrow(svc.ForbiddenError);
  });
  it("画像は今月と先月の2か月分だけ残り、それより前は消える。金額や明細の数字は残る", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const oid = await svc.addMaterialOrder(db, id.staff, store.a1, { ...inp, orderedOn: "2026-08-20", amount: 777, lines: [{ name: "古い商品", qty: 1, amount: 777 }] });
    const iid = await svc.addMaterialImage(db, id.staff, oid, "image/png", png);
    await svc.purgeOldMaterialImages(db, true, "2026-09-30");     // 9月: 8月は「先月」なので残る
    expect(await svc.getMaterialImage(db, id.staff, iid)).not.toBeNull();
    await svc.purgeOldMaterialImages(db, true, "2026-10-01");     // 10月: 8月は2か月前なので消える
    expect(await svc.getMaterialImage(db, id.staff, iid)).toBeNull();
    const o = (await svc.listMaterialOrders(db, id.staff, store.a1, "2026-08-01", "2026-08-31")).find((x) => x.id === oid)!;
    expect(o.amount).toBe(777);
    expect(o.lines).toHaveLength(1);
  });

});

describe("材料費: 業者とカテゴリーを選ぶ・覚える・店長が直す", () => {
  const base = { orderedOn: "2026-10-06", item: "x", kind: "supply" as const, amount: 1000 };
  it("発注に使った業者・カテゴリーは自動で覚え、次から選べる。2回目は増えない", async () => {
    await svc.addMaterialOrder(db, id.staff, store.a1, { ...base, supplier: "髪ドラ", category: "カラー" });
    await svc.addMaterialOrder(db, id.staff, store.a1, { ...base, supplier: "髪ドラ", category: "カラー" });
    await svc.addMaterialOrder(db, id.staff, store.a1, { ...base, supplier: "髪ドラ", category: "ストレート" });
    await svc.addMaterialOrder(db, id.staff, store.a1, { ...base, supplier: "ダリア" });
    const r = await svc.listMaterialDealers(db, id.staff, store.a1);
    expect(r.canManage).toBe(false);
    expect(r.dealers.map((d) => d.name)).toEqual(expect.arrayContaining(["髪ドラ", "ダリア"]));
    expect(r.dealers.find((d) => d.name === "髪ドラ")!.categories.map((c) => c.name)).toEqual(["カラー", "ストレート", "パーマ", "小物", "その他"]);   // はじめのカテゴリーが入る
    expect((await svc.getMaterialMemory(db, id.staff, store.a1)).suppliers).toEqual(expect.arrayContaining(["髪ドラ", "ダリア"]));
    expect((await svc.listMaterialOrders(db, id.mgr, store.a1, "2026-10-01", "2026-10-31")).some((o) => o.supplier === "髪ドラ" && o.category === "ストレート")).toBe(true);
  });
  it("直せるのは店長以上。スタッフは直せない。他店の店長も直せない", async () => {
    const d = (await svc.listMaterialDealers(db, id.mgr, store.a1)).dealers.find((x) => x.name === "ダリア")!;
    await expect(svc.saveMaterialDealer(db, id.staff, store.a1, { kind: "dealer", id: d.id, active: false })).rejects.toThrow();
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "dealer", id: d.id, active: false });
    expect((await svc.listMaterialDealers(db, id.staff, store.a1)).dealers.some((x) => x.name === "ダリア")).toBe(false);   // しまうと、スタッフには出ない
    expect((await svc.listMaterialDealers(db, id.mgr, store.a1)).dealers.find((x) => x.name === "ダリア")!.active).toBe(false);
    expect((await svc.getMaterialMemory(db, id.staff, store.a1)).suppliers).not.toContain("ダリア");
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "dealer", id: d.id, active: true });
    await expect(svc.saveMaterialDealer(db, id.staff2, store.a2, { kind: "dealer", id: d.id, active: false })).rejects.toThrow();
  });
  it("名前を直すと過去の発注の名前もそろう。足す・上下に動かすもできる", async () => {
    const list = (await svc.listMaterialDealers(db, id.mgr, store.a1)).dealers;
    const hd = list.find((x) => x.name === "髪ドラ")!;
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "dealer", id: hd.id, name: "髪どら" });
    const orders = await svc.listMaterialOrders(db, id.mgr, store.a1, "2026-10-01", "2026-10-31");
    expect(orders.filter((o) => o.supplier === "髪どら").length).toBe(3);
    expect(orders.some((o) => o.supplier === "髪ドラ")).toBe(false);
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "category", dealerId: hd.id, name: "スタイリング剤" });
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "dealer", name: "新しい業者" });
    const cat = (await svc.listMaterialDealers(db, id.mgr, store.a1)).dealers.find((x) => x.id === hd.id)!.categories;
    expect(cat.map((c) => c.name)).toEqual(["カラー", "ストレート", "パーマ", "小物", "その他", "スタイリング剤"]);
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "category", id: cat[5].id, move: "up" });
    expect((await svc.listMaterialDealers(db, id.mgr, store.a1)).dealers.find((x) => x.id === hd.id)!.categories.map((c) => c.name)).toEqual(["カラー", "ストレート", "パーマ", "小物", "スタイリング剤", "その他"]);
    await expect(svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "dealer", name: "髪どら" })).rejects.toThrow("同じ名前");
  });
});

describe("材料費: その場で業者・カテゴリーを足す（誰でも）", () => {
  it("スタッフも足せる。すぐ覚えて、ほかの人にも出る。しまってあるものは足せない", async () => {
    await svc.addMaterialChoice(db, id.staff, store.a1, { supplier: "新ディーラー" });
    await svc.addMaterialChoice(db, id.staff, store.a1, { supplier: "新ディーラー", category: "トリートメント" });
    await svc.addMaterialChoice(db, id.staff, store.a1, { supplier: "新ディーラー", category: "トリートメント" });   // 2回目は増えない
    const d = (await svc.listMaterialDealers(db, id.mgr, store.a1)).dealers.find((x) => x.name === "新ディーラー")!;
    expect(d.categories.map((c) => c.name)).toEqual(["カラー", "ストレート", "パーマ", "小物", "その他", "トリートメント"]);
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "category", id: d.categories[5].id, active: false });
    await expect(svc.addMaterialChoice(db, id.staff, store.a1, { supplier: "新ディーラー", category: "トリートメント" })).rejects.toThrow("しまってあります");
    await svc.saveMaterialDealer(db, id.mgr, store.a1, { kind: "dealer", id: d.id, active: false });
    await expect(svc.addMaterialChoice(db, id.staff, store.a1, { supplier: "新ディーラー" })).rejects.toThrow("しまってあります");
    await expect(svc.addMaterialChoice(db, id.staff, store.a1, { supplier: " " })).rejects.toThrow();
    await expect(svc.addMaterialChoice(db, id.staff2, store.a1, { supplier: "他店から" })).rejects.toThrow();
  });
});
