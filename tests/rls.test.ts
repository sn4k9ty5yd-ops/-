import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

// 固定ID
const CO_A = "a0000000-0000-0000-0000-000000000001";
const CO_B = "b0000000-0000-0000-0000-000000000001";
const ST_A1 = "a1000000-0000-0000-0000-000000000001"; // 会社A 店舗1
const ST_A2 = "a1000000-0000-0000-0000-000000000002"; // 会社A 店舗2
const ST_B1 = "b1000000-0000-0000-0000-000000000001"; // 会社B 店舗1
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const U = {
  officeA: uid(1), // 会社A オフィス Lv4
  managerA1: uid(2), // 会社A 店舗1 店長 Lv3
  shiftA1: uid(3), // 会社A 店舗1 シフト担当 Lv2
  staffA1: uid(4), // 会社A 店舗1 スタッフ Lv1
  staffA2: uid(5), // 会社A 店舗2 スタッフ Lv1
  officeB: uid(6), // 会社B オフィス Lv4
  staffB1: uid(7), // 会社B 店舗1 スタッフ Lv1
  retiredA1: uid(8), // 会社A 店舗1 退職（無効化）
};

let db: PGlite;

/** 指定ユーザーとして実行（RLSが効く authenticated ロール） */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${user ? "authenticated" : "anon"};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const fails = async (sql: string) => {
  // RLS違反はエラー、または0行更新のどちらでも「できなかった」とみなす
  try {
    const r = await db.query(sql);
    return (r.affectedRows ?? 0) === 0;
  } catch {
    return true;
  }
};

beforeAll(async () => {
  db = new PGlite();
  // Supabase が提供するものの代用
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated; create role anon;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
  `);
  await db.exec(readFileSync("supabase/migrations/0001_tenant_core.sql", "utf8"));
  await db.exec(`
    insert into auth.users (id) values ${Object.values(U).map((u) => `('${u}')`).join(",")};
    insert into companies (id, code, name) values ('${CO_A}', 'company-a', '会社A'), ('${CO_B}', 'company-b', '会社B');
    insert into stores (id, company_id, name) values
      ('${ST_A1}', '${CO_A}', 'A店1'), ('${ST_A2}', '${CO_A}', 'A店2'), ('${ST_B1}', '${CO_B}', 'B店1');
    insert into memberships (company_id, auth_user_id, store_id, name, email, level, status) values
      ('${CO_A}', '${U.officeA}',   '${ST_A1}', 'オフィスA',   'office@a.example',  4, 'active'),
      ('${CO_A}', '${U.managerA1}', '${ST_A1}', '店長A1',      'mgr@a.example',     3, 'active'),
      ('${CO_A}', '${U.shiftA1}',   '${ST_A1}', 'シフト担当A1', 'shift@a.example',   2, 'active'),
      ('${CO_A}', '${U.staffA1}',   '${ST_A1}', 'スタッフA1',   'staff1@a.example',  1, 'active'),
      ('${CO_A}', '${U.staffA2}',   '${ST_A2}', 'スタッフA2',   'staff2@a.example',  1, 'active'),
      ('${CO_B}', '${U.officeB}',   '${ST_B1}', 'オフィスB',   'office@b.example',  4, 'active'),
      ('${CO_B}', '${U.staffB1}',   '${ST_B1}', 'スタッフB1',   'staff1@b.example',  1, 'active'),
      ('${CO_A}', '${U.retiredA1}', '${ST_A1}', '退職者',       'gone@a.example',    1, 'disabled');
  `);
});

describe("会社ごとのデータ分離", () => {
  it("未ログインは何も見えない・書けない", async () => {
    await as(null, async () => {
      await expect(q("select * from memberships")).rejects.toThrow();
      await expect(q("select * from companies")).rejects.toThrow();
    });
  });

  it("会社Aの人は会社Bのスタッフ・店舗・会社が一切見えない（最大レベルでも）", async () => {
    for (const u of [U.officeA, U.managerA1, U.staffA1]) {
      await as(u, async () => {
        expect(await q(`select 1 from memberships where company_id='${CO_B}'`)).toHaveLength(0);
        expect(await q(`select 1 from stores where company_id='${CO_B}'`)).toHaveLength(0);
        expect(await q(`select 1 from companies where id='${CO_B}'`)).toHaveLength(0);
        expect(await q(`select 1 from audit_logs where company_id='${CO_B}'`)).toHaveLength(0);
      });
    }
  });

  it("会社Aのオフィスは会社Bのデータを作成・変更できない", async () => {
    await as(U.officeA, async () => {
      expect(await fails(`insert into stores (company_id, name) values ('${CO_B}', '侵入')`)).toBe(true);
      expect(
        await fails(`insert into memberships (company_id, store_id, name, email) values ('${CO_B}', '${ST_B1}', 'x', 'x@b.example')`),
      ).toBe(true);
      expect(await fails(`update memberships set name='改ざん' where company_id='${CO_B}'`)).toBe(true);
      expect(await fails(`update memberships set company_id='${CO_B}' where id in (select id from memberships where auth_user_id='${U.staffA1}')`)).toBe(true);
    });
  });

  it("会社Aの店舗に会社Bのスタッフを所属させられない", async () => {
    await expect(
      db.exec(`insert into memberships (company_id, store_id, name, email) values ('${CO_B}', '${ST_A1}', 'x', 'y@b.example')`),
    ).rejects.toThrow();
  });
});

describe("操作レベルごとの見える範囲", () => {
  it("Lv1 スタッフ: 自分の店舗の人だけ見える（他店は見えない）", async () => {
    await as(U.staffA1, async () => {
      const names = (await q("select name from memberships order by name")).map((r) => r.name);
      expect(names).not.toContain("スタッフA2");
      expect(names).toContain("スタッフA1");
      expect(await q("select id from stores")).toHaveLength(1);
    });
  });

  it("Lv1/Lv2: 他のスタッフを変更できない", async () => {
    for (const u of [U.staffA1, U.shiftA1]) {
      await as(u, async () => {
        expect(await fails(`update memberships set name='変更' where auth_user_id='${U.staffA1}'`)).toBe(true);
        expect(await fails(`insert into memberships (company_id, store_id, name, email) values ('${CO_A}','${ST_A1}','新人','n@a.example')`)).toBe(true);
      });
    }
  });

  it("Lv3 店長: 会社内の全店舗を見られる", async () => {
    await as(U.managerA1, async () => {
      expect(await q("select id from stores")).toHaveLength(2);
      const names = (await q("select name from memberships")).map((r) => r.name);
      expect(names).toContain("スタッフA2");
    });
  });

  it("Lv3 店長: 自店舗の入社登録・退職処理はできる", async () => {
    await as(U.managerA1, async () => {
      expect(await fails(`insert into memberships (company_id, store_id, name, email) values ('${CO_A}','${ST_A1}','新人','new@a.example')`)).toBe(false);
      expect(await fails(`update memberships set status='disabled', left_on=current_date where email='new@a.example'`)).toBe(false);
    });
  });

  it("Lv3 店長: 他店舗のスタッフ登録・変更はできない", async () => {
    await as(U.managerA1, async () => {
      expect(await fails(`insert into memberships (company_id, store_id, name, email) values ('${CO_A}','${ST_A2}','他店','o@a.example')`)).toBe(true);
      expect(await fails(`update memberships set name='変更' where auth_user_id='${U.staffA2}'`)).toBe(true);
      // 自店のスタッフを他店へ移す（=他店への登録）もできない
      expect(await fails(`update memberships set store_id='${ST_A2}' where auth_user_id='${U.staffA1}'`)).toBe(true);
    });
  });

  it("Lv4 オフィス: 全店舗のスタッフを登録・変更できる", async () => {
    await as(U.officeA, async () => {
      expect(await fails(`insert into memberships (company_id, store_id, name, email) values ('${CO_A}','${ST_A2}','他店新人','o2@a.example')`)).toBe(false);
      expect(await fails(`update memberships set name='変更済' where auth_user_id='${U.staffA2}'`)).toBe(false);
      expect(await fails(`insert into stores (company_id, name) values ('${CO_A}', '新店舗')`)).toBe(false);
    });
  });

  it("店長以下は店舗を追加・変更できない", async () => {
    for (const u of [U.managerA1, U.shiftA1, U.staffA1]) {
      await as(u, async () => {
        expect(await fails(`insert into stores (company_id, name) values ('${CO_A}', '勝手に追加')`)).toBe(true);
        expect(await fails(`update stores set name='改名' where id='${ST_A1}'`)).toBe(true);
      });
    }
  });
});

describe("レベルの割り当て（オフィスのみ）", () => {
  it("店長は自分や他人のレベルを変えられない（昇格できない）", async () => {
    await as(U.managerA1, async () => {
      expect(await fails(`update memberships set level=4 where auth_user_id='${U.managerA1}'`)).toBe(true);
      expect(await fails(`update memberships set level=3 where auth_user_id='${U.staffA1}'`)).toBe(true);
      // レベル2以上での新規登録もできない（Lv1のみ）
      expect(await fails(`insert into memberships (company_id, store_id, name, email, level) values ('${CO_A}','${ST_A1}','昇格','up@a.example',4)`)).toBe(true);
    });
  });

  it("オフィスはレベルを入れ替えられ、履歴が残る", async () => {
    await as(U.officeA, async () => {
      expect(await fails(`update memberships set level=2 where auth_user_id='${U.staffA1}'`)).toBe(false);
      expect(await fails(`update memberships set level=1 where auth_user_id='${U.staffA1}'`)).toBe(false);
      const logs = await q("select action, detail from audit_logs where action='staff.update'");
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("履歴（監査ログ）はオフィスしか見られない", async () => {
    await as(U.managerA1, async () => {
      expect(await q("select 1 from audit_logs")).toHaveLength(0);
    });
  });
});

describe("無効化（退職）", () => {
  it("無効化されたアカウントは何も見えない", async () => {
    await as(U.retiredA1, async () => {
      expect(await q("select 1 from memberships")).toHaveLength(0);
      expect(await q("select 1 from stores")).toHaveLength(0);
      expect(await q("select 1 from companies")).toHaveLength(0);
    });
  });

  it("スタッフは削除できない（退職は無効化で表す）", async () => {
    await as(U.officeA, async () => {
      expect(await fails(`delete from memberships where auth_user_id='${U.staffA1}'`)).toBe(true);
    });
  });
});
