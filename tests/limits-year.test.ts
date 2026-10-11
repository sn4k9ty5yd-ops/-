import { beforeAll, describe, expect, it } from "vitest";
import { daysOf } from "../lib/labels";
import type { Database } from "../lib/db/types";
import * as svc from "../lib/service";
import { newDb } from "./helpers";
import { migrate } from "../lib/db/migrate";

let db: Database;
const id: Record<string, string> = {};
let S = ""; let P = ""; let days: string[] = [];

beforeAll(async () => {
  db = await newDb(); await migrate(db);
  const co = (await db.query<{ id: string }>("insert into companies (code, name) values ('y-co','Y') returning id")).rows[0].id;
  S = (await db.query<{ id: string }>("insert into stores (company_id, name) values ($1,'A店') returning id", [co])).rows[0].id;
  const mk = async (k: string, code: string, level: number, rank: string | null, year: number | null) =>
    (id[k] = (await db.query<{ id: string }>("insert into memberships (company_id, store_id, employee_code, name, level, rank, assistant_year) values ($1,$2,$3,$4,$5,$6,$7) returning id", [co, S, code, k, level, rank, year])).rows[0].id);
  await mk("office", "1", 4, null, null); await mk("shift", "2", 2, "stylist", null);
  await mk("sty", "3", 1, "stylist", null); await mk("a1", "4", 1, "assistant", 1); await mk("a1b", "5", 1, "assistant", 1); await mk("a2", "6", 1, "assistant", 2);
  await svc.createNextPeriod(db, id.office, "2026-11-20");
  const p = (await svc.listPeriods(db, id.office))[0]; P = p.id; days = daysOf(p.start, p.end);
});

describe("休める人数の上限を、アシスタントの1年目・2年目で分ける", () => {
  it("1年目・2年目で決めると、アシスタント全体は合計になる。シフト担当が決められる", async () => {
    await svc.setDayLimits(db, id.shift, P, S, days, null, { stylist: 1, assistant: 0, assistant1: 1, assistant2: 2 });
    const l = (await svc.listDayLimits(db, id.shift, P, S))[0];
    expect(l).toMatchObject({ maxStylist: 1, maxAssistant: 3, maxAssistant1: 1, maxAssistant2: 2, maxOff: 4 });
    await expect(svc.setDayLimits(db, id.sty, P, S, days, null, { stylist: 1, assistant: 0, assistant1: 1, assistant2: 1 })).rejects.toThrow(svc.ForbiddenError);
  });
  it("1年目が2人休むと、全体の上限内でも「かぶり」になる。2年目は2人までOK", async () => {
    const d = days[2];
    for (const k of ["a1", "a1b", "a2"]) await db.query("insert into time_off_requests (company_id, membership_id, store_id, period_id, day, kind) select company_id, id, store_id, $2, $3, 'hope' from memberships where id = $1", [id[k], P, d]);
    const c = (await svc.listConflicts(db, id.shift, P, S)).find((x) => x.day === d)!;
    expect(c).toMatchObject({ countAssistant: 3, countAssistant1: 2, maxAssistant1: 1, countAssistant2: 1, maxAssistant2: 2 });
    // 1年目が1人に減れば、かぶりなし
    await db.query("delete from time_off_requests where membership_id = $1 and day = $2", [id.a1b, d]);
    expect((await svc.listConflicts(db, id.shift, P, S)).some((x) => x.day === d)).toBe(false);
  });
  it("これまでの決め方（アシスタント全体だけ）も、そのまま使える", async () => {
    await svc.setDayLimits(db, id.shift, P, S, [days[3]], 3, { stylist: 2, assistant: 1 });
    expect((await svc.listDayLimits(db, id.shift, P, S)).find((x) => x.day === days[3])).toMatchObject({ maxAssistant: 1, maxAssistant1: null, maxAssistant2: null });
  });
});

describe("お店ごとの休める人数の標準", () => {
  it("シフト担当・店長が決められ、スタッフは決められない。他店には影響しない", async () => {
    expect(await svc.getOffDefault(db, id.shift, S)).toBeNull();
    await svc.setOffDefault(db, id.shift, S, { stylist: 1, assistant: 1 });
    expect(await svc.getOffDefault(db, id.a1, S)).toMatchObject({ stylist: 1, assistant: 1, assistant1: null, assistant2: null });
    await expect(svc.setOffDefault(db, id.sty, S, { stylist: 2, assistant: 2 })).rejects.toThrow(svc.ForbiddenError);
    await svc.setOffDefault(db, id.office, S, { stylist: 1, assistant: 0, assistant1: 1, assistant2: 2 });
    expect(await svc.getOffDefault(db, id.office, S)).toMatchObject({ stylist: 1, assistant: 3, assistant1: 1, assistant2: 2 });
  });
});
