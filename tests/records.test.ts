import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";

let db: Database;
const id: Record<string, string> = {};
const st: Record<string, string> = {};

beforeAll(async () => {
  db = await newDb();
  await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('rec','株式会社テスト') returning id")).rows[0].id;
  for (const n of ["A店", "B店"]) st[n] = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,$2) returning id", [co, n])).rows[0].id;
  const mk = async (k: string, code: string, level: number, s: string, name: string) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id", [co, s, code, name, level])).rows[0].id);
  await mk("office", "1", 4, st["A店"], "事務員"); await mk("mgr", "2", 3, st["A店"], "店長"); await mk("a", "3", 1, st["A店"], "山田"); await mk("b", "4", 1, st["B店"], "他店");
  await svc.addMaterialOrder(db, id.a, st["A店"], { orderedOn: "2026-05-10", supplier: "甲商事", item: "カラー剤", kind: "supply", amount: 11000, taxMode: "in" });
  const cancelled = await svc.addMaterialOrder(db, id.b, st["B店"], { orderedOn: "2026-06-01", supplier: "乙", item: "取り消す分", kind: "supply", amount: 500 });
  await svc.cancelMaterialOrder(db, id.office, cancelled);
  await svc.saveSales(db, id.mgr, st["A店"], "2026-05", [{ membershipId: id.a, values: { ...svc.EMPTY_SALES, total: 300000, customers: 40, kitsukeSales: 20000 } }]);
});

describe("税務署などに出す書面", () => {
  it("管理者だけが作れる", async () => {
    await expect(svc.exportRecords(db, id.mgr, { from: "2026-01-01", to: "2026-12-31", sections: ["staff"] })).rejects.toThrow(svc.ForbiddenError);
    await expect(svc.exportRecords(db, id.a, { from: "2026-01-01", to: "2026-12-31", sections: ["staff"] })).rejects.toThrow(svc.ForbiddenError);
  });

  it("期間と項目をえらんで、全店の記録がまとまる（パスコードは入らない・取り消した発注も記録として残る）", async () => {
    const d = await svc.exportRecords(db, id.office, { from: "2026-01-01", to: "2026-12-31", sections: ["staff", "materials", "sales", "audit"] });
    expect(d.meta).toMatchObject({ company: "株式会社テスト", from: "2026-01-01", by: "事務員" });
    expect(d.staff?.map((r) => r["氏名"])).toEqual(["事務員", "店長", "山田", "他店"]);
    expect(JSON.stringify(d)).not.toMatch(/passcode|scrypt/);
    expect(d.materials).toHaveLength(2);
    expect(d.materials?.find((r) => r["内容"] === "カラー剤")).toMatchObject({ "金額(税抜)": 10000, "入力": "税込で入力", "入力した税込額": 11000, "記入した人": "山田" });
    expect(d.materials?.find((r) => r["内容"] === "取り消す分")?.["取り消し"]).toMatch(/^取り消し/);
    expect(d.materialsByMonth).toEqual([{ "月": "2026-05", "店舗": "A店", "合計(税抜)": "10000", "件数": 1 }].map((r) => ({ ...r, "合計(税抜)": expect.anything() })));
    expect(d.sales?.[0]).toMatchObject({ "月": "2026-05", "氏名": "山田", "総合売上": 300000, "着付け売上": 20000 });
    expect(d.attendance).toBeUndefined();                 // えらんでいない項目は入らない
    expect(d.meta.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("期間の外の記録は入らない。書面を作ったことが、操作の記録に残る。項目が空・期間がおかしいときは断る", async () => {
    const d = await svc.exportRecords(db, id.office, { from: "2025-01-01", to: "2025-12-31", sections: ["materials", "sales"] });
    expect(d.materials).toHaveLength(0); expect(d.sales).toHaveLength(0);
    const adm = await svc.securityOverview(db, id.office);
    expect(adm.admin?.audit.some((a) => a.action === "records.export")).toBe(true);
    await expect(svc.exportRecords(db, id.office, { from: "2026-01-01", to: "2026-12-31", sections: [] })).rejects.toThrow("1つ以上");
    await expect(svc.exportRecords(db, id.office, { from: "2026-12-31", to: "2026-01-01", sections: ["staff"] })).rejects.toThrow("期間");
  });

  it("全項目（くわしい記録つき）でも作れる", async () => {
    const d = await svc.exportRecords(db, id.office, { from: "2026-01-01", to: "2026-12-31", sections: svc.RECORD_SECTIONS.map(([k]) => k), detail: true });
    for (const k of ["staff", "attendance", "attendanceDaily", "sales", "materials", "stocktake", "stocktakeLines", "leavePlans", "leaveChanges", "lessons", "audit"] as const) expect(Array.isArray(d[k]), k).toBe(true);
  });

  it("社員と、書類ごとの期間をえらべる（えらんだ人の分だけ・書類ごとに期間がちがう）", async () => {
    const d = await svc.exportRecords(db, id.office, { from: "2026-01-01", to: "2026-12-31", sections: ["staff", "sales", "materials"], staffIds: [id.a], ranges: { sales: { from: "2026-06-01", to: "2026-06-30" } } });
    expect(d.staff?.map((r) => r["氏名"])).toEqual(["山田"]);
    expect(d.sales).toHaveLength(0);                       // 売上は6月だけ（5月の分は入らない）
    expect(d.materials).toHaveLength(2);                   // 材料費は人にひもづかない・全体の期間
    expect(d.meta.staff).toEqual(["山田（3）"]);
    expect(d.meta.ranges?.sales).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    const all = await svc.exportRecords(db, id.office, { from: "2026-01-01", to: "2026-12-31", sections: ["sales"], staffIds: [id.a] });
    expect(all.sales).toHaveLength(1);
    const other = await svc.exportRecords(db, id.office, { from: "2026-01-01", to: "2026-12-31", sections: ["sales"], staffIds: [id.b] });
    expect(other.sales).toHaveLength(0);
  });
});
