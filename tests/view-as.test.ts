import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";
import type { Database } from "../lib/db/types";
import { asUser } from "../lib/db/user-context";
import { setViewAsKey } from "../lib/db/view-as";
import * as svc from "../lib/service";

let db: Database; let owner = "", staff = ""; let store = "";
beforeAll(async () => {
  db = await newDb(); await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('va-co','V') returning id")).rows[0].id;
  store = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A店') returning id", [co])).rows[0].id;
  owner = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level, app_owner) values ($1,$2,'1','制作者',4,true) returning id", [co, store])).rows[0].id;
  staff = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,'2','山田',1) returning id", [co, store])).rows[0].id;
});
afterAll(() => { setViewAsKey(owner, null); });

describe("アプリ制作者の見え方の切りかえ", () => {
  it("制作者だけが切りかえられる。ほかの人は不可", async () => {
    await expect(svc.setViewAs(db, staff, "manager")).rejects.toThrow(svc.ForbiddenError);
    expect((await svc.getMe(db, staff))?.canViewAs).toBeUndefined();
  });
  it("切りかえると、画面の権限も、DBの権限判定も、そのレベルになる。もどすと制作者にもどる", async () => {
    const lv = async () => (await asUser(db, owner, (q) => q.query<{ l: number; p: boolean }>("select app.my_level() as l, app.has_perm('level.assign', $1) as p", [store]))).rows[0];
    expect(await lv()).toEqual({ l: 4, p: true });
    const m = await svc.setViewAs(db, owner, "shifter");
    expect(m).toMatchObject({ level: 2, appOwner: false, canViewAs: true, viewAs: { key: "shifter" } });
    expect(await lv()).toEqual({ l: 2, p: false });                  // レベルを決める権限は、もう無い
    const a = await svc.setViewAs(db, owner, "assistant");
    expect(a).toMatchObject({ level: 1, rank: "assistant" });
    const ipad = await svc.setViewAs(db, owner, "ipad");
    expect(ipad?.displayOnly).toBe(true);
    const back = await svc.setViewAs(db, owner, null);
    expect(back).toMatchObject({ level: 4, appOwner: true, viewAs: null });
    expect(await lv()).toEqual({ l: 4, p: true });
    await expect(svc.setViewAs(db, owner, "nope")).rejects.toThrow("見え方");
  });
  it("制作者ではない人には、DBに伝えても、何も起きない", async () => {
    setViewAsKey(staff, "office");                                    // まちがって入っても、DB側で app_owner を確かめる
    const r = (await asUser(db, staff, (q) => q.query<{ l: number }>("select app.my_level() as l"))).rows[0];
    setViewAsKey(staff, null);
    expect(r.l).toBe(1);
  });
  it("見え方を切りかえているときは、自分の行も、その見え方のレベルで出る。本物の店長には、制作者のレベルは見えない", async () => {
    const mgr = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level) select company_id, store_id, '3', '店長', 3 from memberships where id = $1 returning id", [owner])).rows[0].id;
    await svc.setViewAs(db, owner, "manager");
    const mine = (await svc.listStaff(db, owner)).find((s) => s.id === owner)!;
    expect(mine.level).toBe(3); expect(mine.appOwner).toBe(false);
    await svc.setViewAs(db, owner, null);
    const seen = (await svc.listStaff(db, mgr)).find((s) => s.id === owner)!;
    expect(seen.level).toBe(0); expect(seen.appOwner).toBeUndefined(); expect(seen.execView).toBeUndefined();
  });
});
