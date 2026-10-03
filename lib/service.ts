import { issuePasscode } from "./auth/login";
import { generatePasscode, hashPasscode } from "./auth/passcode";
import { calcHours, DEFAULT_BREAK_RULE, validateBreakRule, type BreakRule } from "./hours";
import { upcomingPeriods } from "./periods";
import { asUser } from "./db/user-context";
import type { Database, Queryable } from "./db/types";
import type { Level } from "./permissions";

// 画面(API)から呼ばれる業務処理。権限の判定はすべてDB側(RLS)で行い、ここでは再実装しない。

export interface Me { id: string; name: string; level: Level; storeId: string; companyId: string; companyName: string; closingStartDay: number; breakRule: BreakRule; displayOnly: boolean; }
export interface StoreRow { id: string; name: string; status: "active" | "closed"; defaultOpen: string; defaultClose: string; }
export interface StaffRow {
  id: string; name: string; employeeCode: string; storeId: string; level: Level; status: "active" | "disabled"; manageable: boolean; onShift: boolean; displayOnly: boolean;
}

export class ForbiddenError extends Error {
  constructor(message = "この操作をする権限がありません") { super(message); }
}

export async function getMe(db: Database, userId: string): Promise<Me | null> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query<Omit<Me, "breakRule"> & { cap: number | null; tiers: { overMinutes: number; breakMinutes: number }[] }>(
      `select m.id, m.name, m.level, m.store_id as "storeId", m.company_id as "companyId", c.name as "companyName", c.closing_start_day as "closingStartDay",
              c.work_cap_minutes as cap, c.break_tiers as tiers, m.display_only as "displayOnly"
         from memberships m join companies c on c.id = m.company_id where m.id = $1`, [userId]),
  );
  const r = rows[0];
  if (!r) return null;
  const { cap, tiers, ...me } = r;
  return { ...me, breakRule: { capMinutes: cap, tiers: tiers ?? DEFAULT_BREAK_RULE.tiers } };
}

/** 休憩・実働のルールを変更する（オフィスのみ） */
export async function setBreakRule(db: Database, userId: string, rule: BreakRule): Promise<void> {
  const err = validateBreakRule(rule);
  if (err) throw new Error(err);
  const tiers = [...rule.tiers].sort((a, b) => a.overMinutes - b.overMinutes);
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) =>
      q.query("update companies set work_cap_minutes = $1, break_tiers = $2::jsonb where id = (select company_id from memberships where id = $3) returning id",
        [rule.capMinutes, JSON.stringify(tiers), userId]))).rows.length;
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

export async function listStores(db: Database, userId: string): Promise<StoreRow[]> {
  return (await asUser(db, userId, (q) => q.query<StoreRow>(`select id, name, status, to_char(default_open, 'HH24:MI') as "defaultOpen", to_char(default_close, 'HH24:MI') as "defaultClose" from stores order by status, sort_order, name`))).rows;
}

const cleanName = (name: string) => {
  const n = name.trim();
  if (!n) throw new Error("お店の名前を入力してください");
  if (n.length > 50) throw new Error("お店の名前が長すぎます");
  return n;
};

export async function addStore(db: Database, userId: string, name: string): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const n = cleanName(name);
  try {
    await asUser(db, userId, (q) =>
      q.query(
        "insert into stores (company_id, name, sort_order) values ($1, $2, (select coalesce(max(sort_order), -1) + 1 from stores))", [me.companyId, n]));
  } catch { throw new ForbiddenError(); }
}

export async function renameStore(db: Database, userId: string, storeId: string, name: string): Promise<void> {
  const n = cleanName(name);
  let rows = 0;
  try { rows = (await asUser(db, userId, (q) => q.query("update stores set name = $2 where id = $1 returning id", [storeId, n]))).rows.length; }
  catch { throw new ForbiddenError(); }
  if (rows === 0) throw new ForbiddenError();
}

/** 閉店にする / 再開する。スタッフが在籍中のお店は閉店にできない（先に移動か退職にする） */
export async function setStoreStatus(db: Database, userId: string, storeId: string, status: "active" | "closed"): Promise<void> {
  if (status === "closed") {
    const n = (await asUser(db, userId, (q) => q.query<{ n: number }>("select count(*)::int as n from memberships where store_id = $1 and status = 'active'", [storeId]))).rows[0].n;
    if (n > 0) throw new Error(`このお店には在籍中のスタッフが${n}人います。先に他のお店へ移すか、退職にしてください。`);
  }
  let rows = 0;
  try { rows = (await asUser(db, userId, (q) => q.query("update stores set status = $2 where id = $1 returning id", [storeId, status]))).rows.length; }
  catch { throw new ForbiddenError(); }
  if (rows === 0) throw new ForbiddenError();
}

/** 並び順をひとつ上/下に動かす（となりのお店と入れ替え） */
export async function moveStore(db: Database, userId: string, storeId: string, dir: "up" | "down"): Promise<void> {
  try {
    await asUser(db, userId, async (q) => {
      const list = (await q.query<{ id: string }>("select id from stores where status = 'active' order by sort_order, name")).rows.map((r) => r.id);
      const i = list.indexOf(storeId);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      for (const [k, id] of list.entries()) {
        const r = await q.query("update stores set sort_order = $2 where id = $1 returning id", [id, k]);
        if (r.rows.length === 0) throw new ForbiddenError(); // 権限が無いと0件になる → 全体を取り消す
      }
    });
  } catch { throw new ForbiddenError(); }
}

export async function listStaff(db: Database, userId: string): Promise<StaffRow[]> {
  const me = await getMe(db, userId);
  if (!me) return [];
  const { rows } = await asUser(db, userId, (q) =>
    q.query<StaffRow>(
      `select id, name, employee_code as "employeeCode", store_id as "storeId", level, status, on_shift as "onShift", display_only as "displayOnly" from memberships order by store_id, level desc, name`));
  // 「操作できる人」かは、画面のボタン表示のための目安（本当の判定はDBが行う）
  return rows.map((r) => ({
    ...r,
    manageable: me.level === 4 || (me.level === 3 && r.storeId === me.storeId && r.level < me.level),
  }));
}

/** スタッフ登録。パスコードを発行して返す（このときだけ見られる） */
export async function addStaff(
  db: Database, userId: string,
  input: { name: string; employeeCode: string; storeId: string; level: Level; displayOnly?: boolean },
): Promise<{ id: string; passcode: string }> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  let id: string;
  try {
    id = (await asUser(db, userId, (q) =>
      q.query<{ id: string }>(
        `insert into memberships (company_id, store_id, employee_code, name, level, on_shift, display_only) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [me.companyId, input.storeId, input.employeeCode.trim(), input.name.trim(), input.displayOnly ? 1 : input.level, !input.displayOnly, !!input.displayOnly]))).rows[0].id;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("その社員番号はすでに使われています");
    throw new ForbiddenError();
  }
  return { id, passcode: await issuePasscode(db, id) };
}

/** 「この人に対して更新できるか」をDBの権限ルールで確かめる（実際には何も変えない） */
async function assertCanManage(db: Database, userId: string, targetId: string) {
  const { rows } = await asUser(db, userId, (q) => q.query("update memberships set name = name where id = $1 returning id", [targetId]));
  if (rows.length === 0) throw new ForbiddenError();
}

export async function disableStaff(db: Database, userId: string, targetId: string): Promise<void> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query("update memberships set status = 'disabled', left_on = current_date where id = $1 and id <> $2 returning id", [targetId, userId]));
  if (rows.length === 0) throw new ForbiddenError();
  await db.query("delete from sessions where membership_id = $1", [targetId]);
}

export async function setStaffLevel(db: Database, userId: string, targetId: string, level: Level): Promise<void> {
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) =>
      q.query("update memberships set level = $2 where id = $1 and id <> $3 returning id", [targetId, level, userId]))).rows.length;
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** 退職した人の社員番号を「◯◯-退職」に変えて、元の番号を空ける（管理者のみ・退職者のみ） */
export async function releaseRetiredCode(db: Database, userId: string, targetId: string): Promise<string> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  const cur = (await asUser(db, userId, (q) =>
    q.query<{ code: string; status: string }>("select employee_code as code, status from memberships where id = $1", [targetId]))).rows[0];
  if (!cur) throw new ForbiddenError();
  if (cur.status !== "disabled") throw new Error("退職（無効）の人だけ、番号を空けられます");
  if (cur.code.includes("-退職")) throw new Error("この人の番号は、すでに空けてあります");
  for (let n = 1; n < 50; n++) {
    const next = `${cur.code}-退職${n === 1 ? "" : n}`;
    try {
      const r = await asUser(db, userId, (q) =>
        q.query("update memberships set employee_code = $2 where id = $1 and status = 'disabled' returning id", [targetId, next]));
      if (r.rows.length === 0) throw new ForbiddenError();
      return cur.code;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") continue;
      throw e instanceof ForbiddenError ? e : new ForbiddenError();
    }
  }
  throw new Error("番号を空けられませんでした");
}

/** パスコードの再発行（忘れたとき）。新しいパスコードを返す */
export async function reissuePasscode(db: Database, userId: string, targetId: string): Promise<string> {
  await assertCanManage(db, userId, targetId);
  return issuePasscode(db, targetId);
}

// ------------------------------------------------------------------ シフト期間・希望休

export type PeriodStatus = "preparing" | "collecting" | "closed" | "drafting" | "confirmed" | "published" | "submitted" | "acknowledged";
export type AttendanceStatus = "open" | "submitted" | "acknowledged";
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { open: "入力中", submitted: "オフィスに提出済み", acknowledged: "確認済み" };
export const STATUS_ORDER: PeriodStatus[] = ["preparing", "collecting", "closed", "drafting", "confirmed", "published", "submitted", "acknowledged"];
export const STATUS_LABEL: Record<PeriodStatus, string> = {
  preparing: "準備中", collecting: "希望休受付中", closed: "受付終了", drafting: "シフト作成中",
  confirmed: "確定", published: "公開済み", submitted: "オフィスに提出済み", acknowledged: "確認済み",
};

export interface PeriodRow {
  id: string; label: string; start: string; end: string;
  stores: { storeId: string; status: PeriodStatus; openAt: string | null; closeAt: string | null; attendanceStatus: AttendanceStatus }[];
}
export interface RequestRow { id: string; membershipId: string; storeId: string; periodId: string; day: string; kind: string; }

export async function listPeriods(db: Database, userId: string): Promise<PeriodRow[]> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query<{ id: string; label: string; start: string; end: string; storeId: string | null; status: PeriodStatus | null; openAt: string | null; closeAt: string | null; attendanceStatus: AttendanceStatus | null }>(
      `select p.id, p.label, p.start_date::text as start, p.end_date::text as "end",
              sp.store_id as "storeId", sp.status, sp.request_open_at::text as "openAt", sp.request_close_at::text as "closeAt", sp.attendance_status as "attendanceStatus"
         from shift_periods p
         left join store_period_status sp on sp.period_id = p.id
         left join stores st on st.id = sp.store_id
        order by p.start_date desc, st.sort_order, st.name`));
  const map = new Map<string, PeriodRow>();
  for (const r of rows) {
    const p = map.get(r.id) ?? { id: r.id, label: r.label, start: r.start, end: r.end, stores: [] };
    if (r.storeId && r.status) p.stores.push({ storeId: r.storeId, status: r.status, openAt: r.openAt, closeAt: r.closeAt, attendanceStatus: r.attendanceStatus ?? "open" });
    map.set(r.id, p);
  }
  return [...map.values()];
}

/** 次の期間（まだ無い最初の期間）を作り、全店舗の進行状況を「準備中」で用意する（オフィスのみ） */
export async function createNextPeriod(db: Database, userId: string, today: string): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      const startDay = (await q.query<{ d: number }>("select closing_start_day as d from companies where id = $1", [me.companyId])).rows[0].d;
      const last = (await q.query<{ e: string | null }>("select max(end_date)::text as e from shift_periods")).rows[0].e;
      let from = today;
      if (last) { const d = new Date(last + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); from = d.toISOString().slice(0, 10); }
      const p = upcomingPeriods(from, startDay, 1)[0];
      const id = (await q.query<{ id: string }>(
        "insert into shift_periods (company_id, start_date, end_date, label) values ($1,$2,$3,$4) returning id", [me.companyId, p.start, p.end, p.label])).rows[0].id;
      await q.query(
        "insert into store_period_status (period_id, store_id, company_id) select $1, id, company_id from stores where status = 'active' and company_id = $2", [id, me.companyId]);
    });
  } catch { throw new ForbiddenError(); }
}

export async function setPeriodStatus(
  db: Database, userId: string,
  input: { periodId: string; storeId: string; status?: PeriodStatus; openAt?: string | null; closeAt?: string | null },
): Promise<void> {
  if (input.status && !STATUS_ORDER.includes(input.status)) throw new Error("状態が正しくありません");
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) =>
      q.query(
        `update store_period_status set
            status = coalesce($3, status),
            request_open_at  = case when $4::boolean then $5::timestamptz else request_open_at end,
            request_close_at = case when $6::boolean then $7::timestamptz else request_close_at end
          where period_id = $1 and store_id = $2 returning period_id`,
        [input.periodId, input.storeId, input.status ?? null,
         input.openAt !== undefined, input.openAt ?? null, input.closeAt !== undefined, input.closeAt ?? null]))).rows.length;
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

export async function listRequests(db: Database, userId: string, periodId: string): Promise<RequestRow[]> {
  return (await asUser(db, userId, (q) =>
    q.query<RequestRow>(
      `select id, membership_id as "membershipId", store_id as "storeId", period_id as "periodId", day::text as day, kind
         from time_off_requests where period_id = $1 order by day`, [periodId]))).rows;
}

/** 自分の希望休をオン/オフする（受付中のみ。ルールはDBが判定） */
export async function toggleMyRequest(db: Database, userId: string, periodId: string, day: string, kind = "hope"): Promise<"added" | "removed"> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  if (me.displayOnly) throw new Error("このアカウントは、見るだけです（希望休は出せません）");
  try {
    return await asUser(db, userId, async (q) => {
      const del = await q.query("delete from time_off_requests where membership_id = $1 and period_id = $2 and day = $3 returning id", [userId, periodId, day]);
      if (del.rows.length > 0) return "removed" as const;
      await q.query(
        "insert into time_off_requests (company_id, membership_id, store_id, period_id, day, kind) values ($1,$2,$3,$4,$5,$6)",
        [me.companyId, userId, me.storeId, periodId, day, kind]);
      return "added" as const;
    });
  } catch { throw new Error("いまは希望休を変更できません（受付期間外、または期間外の日付です）"); }
}

export async function listNames(db: Database, userId: string): Promise<{ id: string; name: string; storeId: string }[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ id: string; name: string; storeId: string }>(
      `select id, name, store_id as "storeId" from memberships where status = 'active' order by store_id, level desc, name`))).rows;
}


// ------------------------------------------------------------------ シフト
export type ShiftKind = "work" | "off" | "paid" | "holiday" | "other";
export interface ShiftRow { id: string; membershipId: string; storeId: string; periodId: string; day: string; kind: ShiftKind; start: string | null; end: string | null; }
export interface ShiftEntry { membershipId: string; day: string; kind: ShiftKind; start?: string | null; end?: string | null; }
export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = { work: "出勤", off: "休み", paid: "有給", holiday: "公休", other: "その他" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS: ShiftKind[] = ["work", "off", "paid", "holiday", "other"];

export async function setStoreHours(db: Database, userId: string, storeId: string, open: string, close: string): Promise<void> {
  if (!TIME.test(open) || !TIME.test(close) || close <= open) throw new Error("オープンとクローズの時間が正しくありません");
  let n = 0;
  try { n = (await asUser(db, userId, (q) => q.query("update stores set default_open = $2, default_close = $3 where id = $1 returning id", [storeId, open, close]))).rows.length; }
  catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

export async function setOnShift(db: Database, userId: string, targetId: string, onShift: boolean): Promise<void> {
  let n = 0;
  try { n = (await asUser(db, userId, (q) => q.query("update memberships set on_shift = $2 where id = $1 returning id", [targetId, onShift]))).rows.length; }
  catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** シフト表に載せる人（その店舗の在籍者でシフトに入る人） */
export async function listRoster(db: Database, userId: string, storeId: string): Promise<{ id: string; name: string; level: Level }[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ id: string; name: string; level: Level }>(
      "select id, name, level from memberships where store_id = $1 and status = 'active' and on_shift order by level desc, name", [storeId]))).rows;
}

export async function listShifts(db: Database, userId: string, periodId: string, storeId: string): Promise<ShiftRow[]> {
  return (await asUser(db, userId, (q) =>
    q.query<ShiftRow>(
      `select id, membership_id as "membershipId", store_id as "storeId", period_id as "periodId", day::text as day, kind,
              to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end"
         from shifts where period_id = $1 and store_id = $2 order by day`, [periodId, storeId]))).rows;
}

/** 編集できる状態か（権限＋進行状況）。画面の表示と、保存前の確認に使う */
export async function canEditShifts(db: Database, userId: string, periodId: string, storeId: string): Promise<boolean> {
  return (await asUser(db, userId, (q) =>
    q.query<{ ok: boolean }>("select app.has_perm('shift.edit', $2) and app.shift_editable($1, $2) as ok", [periodId, storeId]))).rows[0].ok;
}

const NOT_EDITABLE = "いまはシフトを変更できません（確定済み、またはその期間・お店の権限がありません）";

function validateEntry(e: ShiftEntry) {
  if (!KINDS.includes(e.kind)) throw new Error("種類が正しくありません");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day)) throw new Error("日付が正しくありません");
  if (e.kind === "work") {
    if (!e.start || !e.end || !TIME.test(e.start) || !TIME.test(e.end)) throw new Error("入店と退店の時間を入れてください");
    if (e.end <= e.start) throw new Error("退店は入店より後の時間にしてください");
  }
}

/** シフトを保存（同じ人・同じ日は上書き）。1件でも失敗したら全部取り消す */
export async function saveShifts(db: Database, userId: string, periodId: string, storeId: string, entries: ShiftEntry[]): Promise<number> {
  entries.forEach(validateEntry);
  if (entries.length === 0) return 0;
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  if (!(await canEditShifts(db, userId, periodId, storeId))) throw new ForbiddenError(NOT_EDITABLE);
  try {
    await asUser(db, userId, async (q) => {
      for (const e of entries)
        await q.query(
          `insert into shifts (company_id, store_id, period_id, membership_id, day, kind, start_time, end_time)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (membership_id, day) do update set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time`,
          [me.companyId, storeId, periodId, e.membershipId, e.day, e.kind, e.kind === "work" ? e.start : null, e.kind === "work" ? e.end : null]);
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("outside the period")) throw new Error("この期間の外の日付が含まれています");
    if (msg.includes("roster") || msg.includes("not belong") || msg.includes("not active")) throw new Error("このお店のシフトに入るスタッフを選んでください");
    throw new ForbiddenError(NOT_EDITABLE);
  }
  return entries.length;
}

export async function clearShifts(db: Database, userId: string, periodId: string, storeId: string, items: { membershipId: string; day: string }[]): Promise<number> {
  if (items.length === 0) return 0;
  if (!(await canEditShifts(db, userId, periodId, storeId))) throw new ForbiddenError(NOT_EDITABLE);
  return asUser(db, userId, async (q) => {
    let n = 0;
    for (const it of items) n += (await q.query("delete from shifts where period_id = $1 and store_id = $2 and membership_id = $3 and day = $4 returning id", [periodId, storeId, it.membershipId, it.day])).rows.length;
    return n;
  });
}

/** 希望休を、シフトの「休み/有給」として一括で反映（すでにシフトがある日は上書きしない） */
export async function applyRequests(db: Database, userId: string, periodId: string, storeId: string): Promise<number> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  if (!(await canEditShifts(db, userId, periodId, storeId))) throw new ForbiddenError(NOT_EDITABLE);
  return asUser(db, userId, async (q) =>
    (await q.query(
      `insert into shifts (company_id, store_id, period_id, membership_id, day, kind)
       select r.company_id, r.store_id, r.period_id, r.membership_id, r.day,
              case r.kind when 'paid' then 'paid' when 'holiday' then 'holiday' when 'other' then 'other' else 'off' end
         from time_off_requests r join memberships m on m.id = r.membership_id
        where r.period_id = $1 and r.store_id = $2 and m.status = 'active' and m.on_shift
       on conflict (membership_id, day) do nothing returning id`, [periodId, storeId])).rows.length);
}

/**
 * 全員を基本時間で一括入力。希望休の人は休み/有給にする。
 * overwrite=false のときは、すでにシフトがある人・日は変えない。
 */
export async function fillDefault(
  db: Database, userId: string,
  input: { periodId: string; storeId: string; days: string[]; membershipIds?: string[]; start: string; end: string; overwrite?: boolean },
): Promise<number> {
  if (!TIME.test(input.start) || !TIME.test(input.end) || input.end <= input.start) throw new Error("入店と退店の時間が正しくありません");
  const roster = (await listRoster(db, userId, input.storeId)).map((r) => r.id).filter((id) => !input.membershipIds || input.membershipIds.includes(id));
  const existing = new Set((await listShifts(db, userId, input.periodId, input.storeId)).map((s) => `${s.membershipId}|${s.day}`));
  const reqs = new Map((await listRequests(db, userId, input.periodId)).map((r) => [`${r.membershipId}|${r.day}`, r.kind]));
  const entries: ShiftEntry[] = [];
  for (const day of input.days) for (const id of roster) {
    const k = `${id}|${day}`;
    if (!input.overwrite && existing.has(k)) continue;
    const req = reqs.get(k);
    entries.push(req ? { membershipId: id, day, kind: req === "paid" ? "paid" : req === "holiday" ? "holiday" : "off" } : { membershipId: id, day, kind: "work", start: input.start, end: input.end });
  }
  return saveShifts(db, userId, input.periodId, input.storeId, entries);
}


// ------------------------------------------------------------------ 出勤簿
export interface AttendanceRow {
  id: string; membershipId: string; storeId: string; periodId: string; day: string; kind: ShiftKind;
  clockIn: string | null; clockOut: string | null; breakMin: number; workMin: number; note: string | null; edited: boolean; source: string;
}
export interface AttendanceEntry { membershipId: string; day: string; kind: ShiftKind; clockIn?: string | null; clockOut?: string | null; breakMin?: number; note?: string | null; }

const NOT_EDITABLE_ATT = "いまは出勤簿を変更できません（提出済み・確認済み、または権限がありません）";

export async function listAttendanceRoster(db: Database, userId: string, periodId: string, storeId: string): Promise<{ id: string; name: string; status: string }[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ id: string; name: string; status: string }>(
      `select id, name, status from memberships
        where store_id = $2 and ((status = 'active' and on_shift) or id in (select membership_id from attendance_records where period_id = $1))
        order by level desc, name`, [periodId, storeId]))).rows;
}

export async function listAttendance(db: Database, userId: string, periodId: string, storeId: string): Promise<{ rows: AttendanceRow[]; editable: boolean }> {
  return asUser(db, userId, async (q) => ({
    rows: (await q.query<AttendanceRow>(
      `select id, membership_id as "membershipId", store_id as "storeId", period_id as "periodId", day::text as day, kind,
              to_char(clock_in, 'HH24:MI') as "clockIn", to_char(clock_out, 'HH24:MI') as "clockOut",
              break_minutes as "breakMin", work_minutes as "workMin", note, edited, source
         from attendance_records where period_id = $1 and store_id = $2 order by day`, [periodId, storeId])).rows,
    editable: (await q.query<{ ok: boolean }>("select app.has_perm('attendance.edit', $2) and app.attendance_editable($1, $2) as ok", [periodId, storeId])).rows[0].ok,
  }));
}

function checkAttendanceEntry(e: AttendanceEntry, rule: BreakRule): { breakMin: number } {
  if (!KINDS.includes(e.kind)) throw new Error("種類が正しくありません");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day)) throw new Error("日付が正しくありません");
  if (e.kind !== "work") return { breakMin: 0 };
  if (!e.clockIn || !e.clockOut || !TIME.test(e.clockIn) || !TIME.test(e.clockOut)) throw new Error("入店と退店の時間を入れてください");
  if (e.clockOut <= e.clockIn) throw new Error("退店は入店より後の時間にしてください");
  const h = calcHours(e.clockIn, e.clockOut, rule);
  const breakMin = e.breakMin ?? h.breakMin;                       // 指定が無ければ会社のルールで自動計算
  if (!Number.isInteger(breakMin) || breakMin < 0) throw new Error("休憩の分数が正しくありません");
  if (breakMin > h.stay) throw new Error("休憩が在店時間より長くなっています");
  return { breakMin };
}

async function upsertAttendance(db: Database, userId: string, periodId: string, storeId: string, entries: AttendanceEntry[], opts: { edited: boolean; source: "manual" | "shift" | "bulk" }): Promise<number> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const prepared = entries.map((e) => ({ e, ...checkAttendanceEntry(e, me.breakRule) }));
  if (prepared.length === 0) return 0;
  if (!(await asUser(db, userId, (q) => q.query<{ ok: boolean }>("select app.has_perm('attendance.edit', $2) and app.attendance_editable($1, $2) as ok", [periodId, storeId]))).rows[0].ok)
    throw new ForbiddenError(NOT_EDITABLE_ATT);
  try {
    await asUser(db, userId, async (q) => {
      for (const { e, breakMin } of prepared)
        await q.query(
          `insert into attendance_records (company_id, store_id, period_id, membership_id, day, kind, clock_in, clock_out, break_minutes, note, edited, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (membership_id, day) do update set kind = excluded.kind, clock_in = excluded.clock_in, clock_out = excluded.clock_out,
             break_minutes = excluded.break_minutes, note = excluded.note, edited = excluded.edited, source = excluded.source`,
          [me.companyId, storeId, periodId, e.membershipId, e.day, e.kind, e.kind === "work" ? e.clockIn : null, e.kind === "work" ? e.clockOut : null,
           breakMin, e.note?.trim() || null, opts.edited, opts.source]);
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("outside the period")) throw new Error("この期間の外の日付が含まれています");
    if (msg.includes("not belong")) throw new Error("このお店のスタッフを選んでください");
    throw new ForbiddenError(NOT_EDITABLE_ATT);
  }
  return prepared.length;
}

/** 一人ずつの入力・修正。「個別に直した日」の目印がつき、あとの一括入力で上書きされない */
export function saveAttendance(db: Database, userId: string, periodId: string, storeId: string, entries: AttendanceEntry[]) {
  return upsertAttendance(db, userId, periodId, storeId, entries, { edited: true, source: "manual" });
}

export async function clearAttendance(db: Database, userId: string, periodId: string, storeId: string, items: { membershipId: string; day: string }[]): Promise<number> {
  if (items.length === 0) return 0;
  if (!(await asUser(db, userId, (q) => q.query<{ ok: boolean }>("select app.has_perm('attendance.edit', $2) and app.attendance_editable($1, $2) as ok", [periodId, storeId]))).rows[0].ok)
    throw new ForbiddenError(NOT_EDITABLE_ATT);
  return asUser(db, userId, async (q) => {
    let n = 0;
    for (const it of items) n += (await q.query("delete from attendance_records where period_id = $1 and store_id = $2 and membership_id = $3 and day = $4 returning id", [periodId, storeId, it.membershipId, it.day])).rows.length;
    return n;
  });
}

/** シフトから出勤簿の下書きを作る。一人ずつ直した日は変えない。overwrite=false なら、すでに入っている日も変えない */
export async function draftAttendanceFromShifts(db: Database, userId: string, periodId: string, storeId: string, overwrite = false): Promise<number> {
  const shifts = await listShifts(db, userId, periodId, storeId);
  const existing = new Map((await listAttendance(db, userId, periodId, storeId)).rows.map((r) => [`${r.membershipId}|${r.day}`, r]));
  const entries: AttendanceEntry[] = [];
  for (const sh of shifts) {
    const cur = existing.get(`${sh.membershipId}|${sh.day}`);
    if (cur && (cur.edited || !overwrite)) continue;
    entries.push(sh.kind === "work" ? { membershipId: sh.membershipId, day: sh.day, kind: "work", clockIn: sh.start, clockOut: sh.end } : { membershipId: sh.membershipId, day: sh.day, kind: sh.kind });
  }
  return upsertAttendance(db, userId, periodId, storeId, entries, { edited: false, source: "shift" });
}

/**
 * 全員同じ時間の一括入力（複数日OK）。シフトで休み・有給などの人は除く。
 * 一人ずつ直した日は、overwrite=true のときだけ上書きする。
 */
export async function fillAttendance(
  db: Database, userId: string,
  input: { periodId: string; storeId: string; days: string[]; membershipIds?: string[]; clockIn: string; clockOut: string; overwrite?: boolean },
): Promise<{ saved: number; skippedEdited: number }> {
  if (!TIME.test(input.clockIn) || !TIME.test(input.clockOut) || input.clockOut <= input.clockIn) throw new Error("入店と退店の時間が正しくありません");
  const roster = (await listRoster(db, userId, input.storeId)).map((r) => r.id).filter((id) => !input.membershipIds || input.membershipIds.includes(id));
  const off = new Set((await listShifts(db, userId, input.periodId, input.storeId)).filter((s) => s.kind !== "work").map((s) => `${s.membershipId}|${s.day}`));
  const existing = new Map((await listAttendance(db, userId, input.periodId, input.storeId)).rows.map((r) => [`${r.membershipId}|${r.day}`, r]));
  const entries: AttendanceEntry[] = []; let skippedEdited = 0;
  for (const day of input.days) for (const id of roster) {
    const k = `${id}|${day}`;
    if (off.has(k)) continue;
    const cur = existing.get(k);
    if (cur?.edited && !input.overwrite) { skippedEdited++; continue; }
    entries.push({ membershipId: id, day, kind: "work", clockIn: input.clockIn, clockOut: input.clockOut });
  }
  return { saved: await upsertAttendance(db, userId, input.periodId, input.storeId, entries, { edited: false, source: "bulk" }), skippedEdited };
}

export async function setAttendanceStatus(db: Database, userId: string, periodId: string, storeId: string, status: AttendanceStatus): Promise<void> {
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) =>
      q.query("update store_period_status set attendance_status = $3 where period_id = $1 and store_id = $2 returning period_id", [periodId, storeId, status]))).rows.length;
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

// ------------------------------------------------------------------ 有給の残り日数（手で入れる方式）
export interface LeaveBalance { membershipId: string; granted: number; used: number; remaining: number; }

export async function listLeave(db: Database, userId: string, storeId: string): Promise<LeaveBalance[]> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query<{ membership_id: string; granted: string; used: string; remaining: string }>("select * from app.leave_balances($1)", [storeId]));
  return rows.map((r) => ({ membershipId: r.membership_id, granted: Number(r.granted), used: Number(r.used), remaining: Number(r.remaining) }));
}

export async function getMyLeave(db: Database, userId: string): Promise<LeaveBalance | null> {
  const me = await getMe(db, userId);
  if (!me) return null;
  return (await listLeave(db, userId, me.storeId)).find((b) => b.membershipId === userId) ?? null;
}

/** 有給日数を付与（プラス）・調整（マイナス）する。履歴は消さずに残る */
export async function addLeaveGrant(db: Database, userId: string, input: { membershipId: string; days: number; grantedOn?: string; note?: string }): Promise<void> {
  if (!Number.isFinite(input.days) || input.days === 0 || Math.abs(input.days) > 99 || Math.round(input.days * 2) !== input.days * 2) throw new Error("日数は 0.5 日きざみで、0 以外の数字を入れてください");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      const t = (await q.query<{ store_id: string }>("select store_id from memberships where id = $1", [input.membershipId])).rows[0];
      if (!t) throw new ForbiddenError();
      await q.query("insert into paid_leave_grants (company_id, store_id, membership_id, days, granted_on, note) values ($1,$2,$3,$4,coalesce($5::date, current_date),$6)",
        [me.companyId, t.store_id, input.membershipId, input.days, input.grantedOn ?? null, input.note?.trim() || null]);
    });
  } catch { throw new ForbiddenError(); }
}

export async function listLeaveHistory(db: Database, userId: string, membershipId: string): Promise<{ days: number; grantedOn: string; note: string | null }[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ days: string; grantedOn: string; note: string | null }>(
      `select days, granted_on::text as "grantedOn", note from paid_leave_grants where membership_id = $1 order by granted_on desc, created_at desc`, [membershipId])))
    .rows.map((r) => ({ days: Number(r.days), grantedOn: r.grantedOn, note: r.note }));
}

// ------------------------------------------------------------------ 商品マスター
export type ProductKind = "retail" | "supply";
export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = { retail: "店販", supply: "業務" };
export interface ProductRow { id: string; kind: ProductKind; maker: string; name: string; spec: string; costPrice: number; status: "active" | "discontinued"; storeIds: string[]; }
export interface ProductInput { maker?: string; name: string; spec?: string; costPrice: number; }

const checkProduct = (p: ProductInput) => {
  if (!p.name?.trim()) throw new Error("品名を入力してください");
  if (!Number.isInteger(p.costPrice) || p.costPrice < 0 || p.costPrice > 100000000) throw new Error(`「${p.name}」の仕入値は、0以上の整数（円）で入れてください`);
};
const isUnique = (e: unknown) => (e as { code?: string }).code === "23505" || /unique|duplicate/i.test((e as Error).message ?? "");

export async function listProducts(db: Database, userId: string, kind: ProductKind): Promise<ProductRow[]> {
  return (await asUser(db, userId, (q) =>
    q.query<ProductRow>(
      `select p.id, p.kind, p.maker, p.name, p.spec, p.cost_price as "costPrice", p.status,
              coalesce((select array_agg(ps.store_id) from product_stores ps where ps.product_id = p.id), '{}') as "storeIds"
         from products p where p.kind = $1 order by p.status, p.maker, p.name, p.spec`, [kind]))).rows;
}

/** 商品をまとめて登録（Excelからの貼り付けにも使う）。同じ商品がすでにあれば飛ばす */
export async function createProducts(db: Database, userId: string, kind: ProductKind, items: ProductInput[], storeIds: string[]): Promise<{ created: number; skipped: number }> {
  if (!["retail", "supply"].includes(kind)) throw new Error("種類が正しくありません");
  items.forEach(checkProduct);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => {
      let created = 0;
      for (const it of items) {
        const r = await q.query<{ id: string }>(
          `insert into products (company_id, kind, maker, name, spec, cost_price) values ($1,$2,$3,$4,$5,$6)
           on conflict (company_id, kind, maker, name, spec) do nothing returning id`,
          [me.companyId, kind, (it.maker ?? "").trim(), it.name.trim(), (it.spec ?? "").trim(), it.costPrice]);
        if (r.rows[0]) {
          created++;
          for (const sid of storeIds) await q.query("insert into product_stores (product_id, store_id, company_id) values ($1,$2,$3)", [r.rows[0].id, sid, me.companyId]);
        }
      }
      return { created, skipped: items.length - created };
    });
  } catch { throw new ForbiddenError(); }
}

export async function updateProduct(db: Database, userId: string, id: string, p: ProductInput & { status?: "active" | "discontinued" }): Promise<void> {
  checkProduct(p);
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) =>
      q.query("update products set maker = $2, name = $3, spec = $4, cost_price = $5, status = coalesce($6, status) where id = $1 returning id",
        [id, (p.maker ?? "").trim(), p.name.trim(), (p.spec ?? "").trim(), p.costPrice, p.status ?? null]))).rows.length;
  } catch (e) { if (isUnique(e)) throw new Error("同じ商品（メーカー・品名・規格）がすでにあります"); throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** この商品を使うお店を、指定の店舗だけにする（共通＝全店、専用＝1店舗） */
export async function setProductStores(db: Database, userId: string, productId: string, storeIds: string[]): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      const exists = await q.query("select 1 from products where id = $1", [productId]);
      if (exists.rows.length === 0) throw new ForbiddenError();
      await q.query("delete from product_stores where product_id = $1 and not (store_id = any($2::uuid[]))", [productId, storeIds]);
      for (const sid of storeIds) await q.query("insert into product_stores (product_id, store_id, company_id) values ($1,$2,$3) on conflict do nothing", [productId, sid, me.companyId]);
    });
  } catch { throw new ForbiddenError(); }
}

// ------------------------------------------------------------------ 棚卸し
export type StocktakeStatus = "open" | "submitted" | "acknowledged";
export const STOCKTAKE_LABEL: Record<StocktakeStatus, string> = { open: "入力中", submitted: "オフィスに提出済み", acknowledged: "確認済み" };
export interface StocktakeRow { id: string; storeId: string; kind: ProductKind; takenOn: string; status: StocktakeStatus; lines: number; counted: number; total: number; }
export interface StocktakeLine { id: string; productId: string | null; maker: string; name: string; spec: string; costPrice: number; quantity: number | null; amount: number; }
export interface StocktakeDetail extends StocktakeRow { lines: number; items: StocktakeLine[]; editable: boolean; canManage: boolean; }

export async function listStocktakes(db: Database, userId: string, storeId: string, kind: ProductKind): Promise<StocktakeRow[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ id: string; storeId: string; kind: ProductKind; takenOn: string; status: StocktakeStatus; lines: number; counted: number; total: string | null }>(
      `select s.id, s.store_id as "storeId", s.kind, s.taken_on::text as "takenOn", s.status,
              count(l.id)::int as lines, count(l.quantity)::int as counted, sum(l.amount)::text as total
         from stocktakes s left join stocktake_lines l on l.stocktake_id = s.id
        where s.store_id = $1 and s.kind = $2 group by s.id order by s.taken_on desc`, [storeId, kind])))
    .rows.map((r) => ({ ...r, total: Number(r.total ?? 0) }));
}

export async function startStocktake(db: Database, userId: string, storeId: string, kind: ProductKind, takenOn: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) throw new Error("棚卸日を入れてください");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => {
      const st = (await q.query<{ id: string }>("insert into stocktakes (company_id, store_id, kind, taken_on) values ($1,$2,$3,$4) returning id", [me.companyId, storeId, kind, takenOn])).rows[0].id;
      await q.query(
        `insert into stocktake_lines (stocktake_id, company_id, store_id, product_id, maker, name, spec, cost_price, sort_order)
         select $1, $2, $3, p.id, p.maker, p.name, p.spec, p.cost_price, row_number() over (order by p.maker, p.name, p.spec)
           from products p join product_stores ps on ps.product_id = p.id
          where ps.store_id = $3 and p.kind = $4 and p.status = 'active'`, [st, me.companyId, storeId, kind]);
      return st;
    });
  } catch (e) {
    if (isUnique(e)) throw new Error("その日の棚卸しは、すでに作られています");
    throw new ForbiddenError();
  }
}

export async function getStocktake(db: Database, userId: string, id: string): Promise<StocktakeDetail | null> {
  return asUser(db, userId, async (q) => {
    const h = (await q.query<{ id: string; storeId: string; kind: ProductKind; takenOn: string; status: StocktakeStatus }>(
      `select id, store_id as "storeId", kind, taken_on::text as "takenOn", status from stocktakes where id = $1`, [id])).rows[0];
    if (!h) return null;
    const items = (await q.query<{ id: string; productId: string | null; maker: string; name: string; spec: string; costPrice: number; quantity: number | null; amount: string }>(
      `select id, product_id as "productId", maker, name, spec, cost_price as "costPrice", quantity, amount::text as amount
         from stocktake_lines where stocktake_id = $1 order by sort_order, maker, name, spec`, [id])).rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    const flags = (await q.query<{ editable: boolean; manage: boolean }>(
      "select app.stocktake_editable($1, $2) as editable, app.has_perm('stocktake.manage', $2) as manage", [id, h.storeId])).rows[0];
    return {
      ...h, lines: items.length, counted: items.filter((i) => i.quantity !== null).length, total: items.reduce((a, i) => a + i.amount, 0),
      items, editable: flags.editable, canManage: flags.manage,
    };
  });
}

/** 数量を保存（整数のみ。空にすると「未入力」に戻る） */
export async function saveQuantities(db: Database, userId: string, stocktakeId: string, entries: { lineId: string; quantity: number | null }[]): Promise<void> {
  for (const e of entries)
    if (e.quantity !== null && (!Number.isInteger(e.quantity) || e.quantity < 0 || e.quantity > 1000000)) throw new Error("数量は、0以上の整数で入れてください");
  let ok = true;
  try {
    await asUser(db, userId, async (q) => {
      for (const e of entries) {
        const r = await q.query("update stocktake_lines set quantity = $3 where id = $1 and stocktake_id = $2 returning id", [e.lineId, stocktakeId, e.quantity]);
        if (r.rows.length === 0) { ok = false; throw new ForbiddenError(); }
      }
    });
  } catch { ok = false; }
  if (!ok) throw new ForbiddenError("いまは数量を変更できません（提出済み・確認済み、または権限がありません）");
}

/** 棚卸しを始めたあとに増えた商品を、一覧に足す */
export async function syncStocktakeProducts(db: Database, userId: string, stocktakeId: string): Promise<number> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => {
      const h = (await q.query<{ storeId: string; kind: ProductKind }>("select store_id as \"storeId\", kind from stocktakes where id = $1", [stocktakeId])).rows[0];
      if (!h) throw new ForbiddenError();
      const base = (await q.query<{ m: number }>("select coalesce(max(sort_order), 0) as m from stocktake_lines where stocktake_id = $1", [stocktakeId])).rows[0].m;
      const r = await q.query(
        `insert into stocktake_lines (stocktake_id, company_id, store_id, product_id, maker, name, spec, cost_price, sort_order)
         select $1, $2, $3, p.id, p.maker, p.name, p.spec, p.cost_price, $5 + row_number() over (order by p.maker, p.name, p.spec)
           from products p join product_stores ps on ps.product_id = p.id
          where ps.store_id = $3 and p.kind = $4 and p.status = 'active'
            and not exists (select 1 from stocktake_lines l where l.stocktake_id = $1 and l.product_id = p.id) returning id`,
        [stocktakeId, me.companyId, h.storeId, h.kind, base]);
      return r.rows.length;
    });
  } catch { throw new ForbiddenError("いまは商品を追加できません"); }
}

export async function setStocktakeStatus(db: Database, userId: string, stocktakeId: string, status: StocktakeStatus): Promise<void> {
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) => q.query("update stocktakes set status = $2 where id = $1 returning id", [stocktakeId, status]))).rows.length;
  } catch (e) {
    const m = (e as Error).message?.match(/there are (\d+) items without a quantity/);
    if (m) throw new Error(`数量が未入力の商品が ${m[1]} 件あります。すべて入れてから提出してください（ない場合は 0 を入れます）`);
    throw new ForbiddenError();
  }
  if (n === 0) throw new ForbiddenError();
}

export async function deleteStocktake(db: Database, userId: string, stocktakeId: string): Promise<void> {
  let n = 0;
  try { n = (await asUser(db, userId, (q) => q.query("delete from stocktakes where id = $1 returning id", [stocktakeId]))).rows.length; }
  catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError("入力中の棚卸しだけ削除できます");
}

// ------------------------------------------------------------------ 棚卸しの合算（店販・業務・店舗・全店）
export interface SummaryPart { id: string; status: StocktakeStatus; lines: number; counted: number; total: number; }
export interface SummaryStore { storeId: string; retail: SummaryPart | null; supply: SummaryPart | null; total: number; }
export interface StocktakeSummary { takenOn: string; stores: SummaryStore[]; retailTotal: number; supplyTotal: number; grandTotal: number; }

/** 棚卸日ごとに、店販・業務・お店ごとの合計、全店の合計を出す（見られる範囲のお店だけ） */
export async function stocktakeSummary(db: Database, userId: string, takenOn: string): Promise<StocktakeSummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) throw new Error("棚卸日を指定してください");
  const { rows } = await asUser(db, userId, (q) =>
    q.query<{ id: string; storeId: string; kind: ProductKind; status: StocktakeStatus; lines: number; counted: number; total: string }>(
      `select s.id, s.store_id as "storeId", s.kind, s.status, count(l.id)::int as lines, count(l.quantity)::int as counted, coalesce(sum(l.amount), 0)::text as total
         from stocktakes s left join stocktake_lines l on l.stocktake_id = s.id
        where s.taken_on = $1 group by s.id`, [takenOn]));
  const by = new Map<string, SummaryStore>();
  for (const r of rows) {
    const s = by.get(r.storeId) ?? { storeId: r.storeId, retail: null, supply: null, total: 0 };
    const part: SummaryPart = { id: r.id, status: r.status, lines: r.lines, counted: r.counted, total: Number(r.total) };
    if (r.kind === "retail") s.retail = part; else s.supply = part;
    s.total = (s.retail?.total ?? 0) + (s.supply?.total ?? 0);
    by.set(r.storeId, s);
  }
  const stores = [...by.values()];
  return {
    takenOn, stores,
    retailTotal: stores.reduce((a, s) => a + (s.retail?.total ?? 0), 0),
    supplyTotal: stores.reduce((a, s) => a + (s.supply?.total ?? 0), 0),
    grandTotal: stores.reduce((a, s) => a + s.total, 0),
  };
}

export async function listStocktakeDates(db: Database, userId: string): Promise<string[]> {
  return (await asUser(db, userId, (q) => q.query<{ d: string }>("select distinct taken_on::text as d from stocktakes order by d desc limit 36"))).rows.map((r) => r.d);
}

// ------------------------------------------------------------------ 在庫管理
export interface StockSettings { useMovements: boolean; useRecount: boolean; useReorder: boolean; trackRetail: boolean; trackSupply: boolean; }
export const DEFAULT_STOCK_SETTINGS: StockSettings = { useMovements: true, useRecount: true, useReorder: true, trackRetail: true, trackSupply: true };
export interface StockItem {
  productId: string; kind: ProductKind; maker: string; name: string; spec: string; costPrice: number; status: "active" | "discontinued";
  quantity: number; min: number | null; target: number | null; low: boolean; suggested: number | null;
}
export interface MovementRow { id: string; productId: string; name: string; kind: "in" | "out" | "recount"; delta: number; after: number | null; note: string | null; at: string; by: string | null; }

export async function getStockSettings(db: Database, userId: string, storeId: string): Promise<StockSettings> {
  const r = (await asUser(db, userId, (q) =>
    q.query<StockSettings>(`select use_movements as "useMovements", use_recount as "useRecount", use_reorder as "useReorder", track_retail as "trackRetail", track_supply as "trackSupply"
                              from store_stock_settings where store_id = $1`, [storeId]))).rows[0];
  return r ?? { ...DEFAULT_STOCK_SETTINGS };
}

/** お店ごとの「使う機能」を決める（店長は自店、オフィスは全店） */
export async function setStockSettings(db: Database, userId: string, storeId: string, s: StockSettings): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, (q) =>
      q.query(
        `insert into store_stock_settings (store_id, company_id, use_movements, use_recount, use_reorder, track_retail, track_supply)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (store_id) do update set use_movements = excluded.use_movements, use_recount = excluded.use_recount, use_reorder = excluded.use_reorder,
           track_retail = excluded.track_retail, track_supply = excluded.track_supply, updated_at = now(), updated_by = $8`,
        [storeId, me.companyId, !!s.useMovements, !!s.useRecount, !!s.useReorder, !!s.trackRetail, !!s.trackSupply, userId]));
  } catch { throw new ForbiddenError(); }
}

export async function listStock(db: Database, userId: string, storeId: string): Promise<{ settings: StockSettings; items: StockItem[] }> {
  const settings = await getStockSettings(db, userId, storeId);
  const rows = (await asUser(db, userId, (q) =>
    q.query<Omit<StockItem, "low" | "suggested">>(
      `select p.id as "productId", p.kind, p.maker, p.name, p.spec, p.cost_price as "costPrice", p.status,
              coalesce(l.quantity, 0) as quantity, l.min_quantity as min, l.target_quantity as target
         from products p join product_stores ps on ps.product_id = p.id and ps.store_id = $1
         left join stock_levels l on l.store_id = $1 and l.product_id = p.id
        where p.status = 'active' or coalesce(l.quantity, 0) > 0
        order by p.kind, p.maker, p.name, p.spec`, [storeId]))).rows;
  const items = rows
    .filter((r) => (r.kind === "retail" ? settings.trackRetail : settings.trackSupply))
    .map((r) => {
      const low = settings.useReorder && r.min !== null && r.quantity <= r.min && r.status === "active";
      return { ...r, low, suggested: low && r.target !== null ? Math.max(0, r.target - r.quantity) : null };
    });
  return { settings, items };
}

const NO_MOVEMENTS = "このお店では「入庫・出庫」を使わない設定になっています";
const NO_RECOUNT = "このお店では「数え直し」を使わない設定になっています";

function mapStockError(e: unknown): never {
  const m = (e as Error).message ?? "";
  const have = m.match(/not enough stock \(have (\d+)\)/);
  if (have) throw new Error(`在庫（${have[1]}個）より多くは出せません`);
  if (/stock_levels_quantity_check|violates check/.test(m)) throw new Error("在庫がマイナスになるため、出せません");
  throw new ForbiddenError("この操作をする権限がないか、このお店で管理していない商品です");
}

/** 入庫（入った）・出庫（使った）を記録。1件でも失敗したら全部取り消し */
export async function recordMovements(db: Database, userId: string, storeId: string, items: { productId: string; kind: "in" | "out"; qty: number; note?: string }[]): Promise<void> {
  for (const it of items) {
    if (!["in", "out"].includes(it.kind)) throw new Error("種類が正しくありません");
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 1000000) throw new Error("数は、1以上の整数で入れてください");
  }
  if (items.length === 0) return;
  if (!(await getStockSettings(db, userId, storeId)).useMovements) throw new Error(NO_MOVEMENTS);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      for (const it of items)
        await q.query("insert into stock_movements (company_id, store_id, product_id, kind, delta, note) values ($1,$2,$3,$4,$5,$6)",
          [me.companyId, storeId, it.productId, it.kind, it.kind === "in" ? it.qty : -it.qty, it.note?.trim() || null]);
    });
  } catch (e) { mapStockError(e); }
}

/** 数え直し: 数えた数を入れると、いまの在庫との差が「数え直し」として記録され、在庫が合う */
export async function recountStock(db: Database, userId: string, storeId: string, entries: { productId: string; counted: number }[], note = "数え直し"): Promise<number> {
  for (const e of entries) if (!Number.isInteger(e.counted) || e.counted < 0 || e.counted > 1000000) throw new Error("数は、0以上の整数で入れてください");
  if (entries.length === 0) return 0;
  if (!(await getStockSettings(db, userId, storeId)).useRecount) throw new Error(NO_RECOUNT);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => {
      let n = 0;
      for (const e of entries) {
        const cur = Number((await q.query<{ quantity: number }>("select quantity from stock_levels where store_id = $1 and product_id = $2", [storeId, e.productId])).rows[0]?.quantity ?? 0);
        const delta = e.counted - cur;
        if (delta === 0) continue;
        await q.query("insert into stock_movements (company_id, store_id, product_id, kind, delta, note) values ($1,$2,$3,'recount',$4,$5)", [me.companyId, storeId, e.productId, delta, note]);
        n++;
      }
      return n;
    });
  } catch (e) { mapStockError(e); }
}

export async function setStockLimits(db: Database, userId: string, storeId: string, productId: string, min: number | null, target: number | null): Promise<void> {
  for (const v of [min, target]) if (v !== null && (!Number.isInteger(v) || v < 0 || v > 1000000)) throw new Error("数は、0以上の整数で入れてください");
  if (min !== null && target !== null && target < min) throw new Error("補充の目標は、発注点以上の数にしてください");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, (q) =>
      q.query(
        `insert into stock_levels (store_id, product_id, company_id, min_quantity, target_quantity) values ($1,$2,$3,$4,$5)
         on conflict (store_id, product_id) do update set min_quantity = excluded.min_quantity, target_quantity = excluded.target_quantity`,
        [storeId, productId, me.companyId, min, target]));
  } catch { throw new ForbiddenError(); }
}

export async function listMovements(db: Database, userId: string, storeId: string, productId?: string, limit = 100): Promise<MovementRow[]> {
  return (await asUser(db, userId, (q) =>
    q.query<MovementRow>(
      `select m.id, m.product_id as "productId", coalesce(m.name, '') as name, m.kind, m.delta, m.quantity_after as after, m.note,
              to_char(m.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as at, u.name as by
         from stock_movements m left join memberships u on u.id = m.created_by
        where m.store_id = $1 and ($2::uuid is null or m.product_id = $2) order by m.created_at desc, m.id desc limit $3`,
      [storeId, productId ?? null, Math.min(Math.max(limit, 1), 500)]))).rows;
}

/** 棚卸しの数量を、在庫に反映する（数え直しとして記録）。提出済み・確認済みの棚卸しだけ */
export async function applyStocktakeToStock(db: Database, userId: string, stocktakeId: string): Promise<number> {
  const d = await getStocktake(db, userId, stocktakeId);
  if (!d || !d.canManage) throw new ForbiddenError();
  if (d.status === "open") throw new Error("提出してから、在庫に反映してください");
  const entries = d.items.filter((i) => i.productId && i.quantity !== null).map((i) => ({ productId: i.productId as string, counted: i.quantity as number }));
  return recountStock(db, userId, d.storeId, entries, `棚卸し ${d.takenOn} を反映`);
}

// ------------------------------------------------------------------ スタッフのまとめて登録
export interface BulkStaffInput { name: string; employeeCode: string; storeId: string; level: Level; displayOnly?: boolean; }
export interface BulkStaffResult { name: string; employeeCode: string; storeId: string; level: Level; displayOnly: boolean; passcode: string; }
const CODE_PATTERN = /^[A-Za-z0-9]{1,20}$/;

/**
 * スタッフをまとめて登録する。1人でも問題があれば、全員を登録しない（途中までは作らない）。
 * dryRun=true なら、チェックだけして、何も作らない。パスコードは、登録した全員分を返す（このときだけ見られる）。
 */
export async function addStaffBulk(db: Database, userId: string, rows: BulkStaffInput[], dryRun = false): Promise<{ count: number; created: BulkStaffResult[] }> {
  if (rows.length === 0) throw new Error("登録する人がいません");
  if (rows.length > 100) throw new Error("一度に登録できるのは、100人までです");
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const at = `${i + 1}人目（${r.name || "名前なし"}）`;
    if (!r.name?.trim() || r.name.trim().length > 50) throw new Error(`${at}：名前を確認してください`);
    if (!CODE_PATTERN.test(r.employeeCode ?? "")) throw new Error(`${at}：社員番号は、英数字（20文字まで）にしてください`);
    if (![1, 2, 3, 4].includes(r.level)) throw new Error(`${at}：レベルが正しくありません`);
    if (seen.has(r.employeeCode)) throw new Error(`${at}：社員番号「${r.employeeCode}」が、2回出てきます`);
    seen.add(r.employeeCode);
  }
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  // すでに使われている社員番号（会社の中）
  const taken = (await db.query<{ employee_code: string }>("select employee_code from memberships where company_id = $1 and employee_code = any($2::text[])", [me.companyId, [...seen]])).rows.map((r) => r.employee_code);
  if (taken.length > 0) throw new Error(`社員番号「${taken.slice(0, 5).join("・")}」は、すでに使われています`);

  // 権限の確認（どのお店・どのレベルに登録できるか）は、データベースのルールで行う。dryRun でも、同じルールで試して取り消す
  const insertAll = async (q: Queryable) => {
    const ids: string[] = [];
    for (const r of rows)
      ids.push((await q.query<{ id: string }>(
        "insert into memberships (company_id, store_id, employee_code, name, level, on_shift, display_only) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [me.companyId, r.storeId, r.employeeCode, r.name.trim(), r.displayOnly ? 1 : r.level, !r.displayOnly, !!r.displayOnly])).rows[0].id);
    return ids;
  };
  class Rollback extends Error {}
  let ids: string[] = [];
  try {
    await asUser(db, userId, async (q) => {
      ids = await insertAll(q);
      if (dryRun) throw new Rollback();               // チェックだけ: 全部取り消す
    });
  } catch (e) {
    if (!(e instanceof Rollback)) {
      if ((e as { code?: string }).code === "23505") throw new Error("すでに使われている社員番号があります");
      throw new ForbiddenError("このお店・このレベルの人を登録する権限がありません（店長は、自分のお店のスタッフ(レベル1)だけ登録できます）");
    }
  }
  if (dryRun) return { count: rows.length, created: [] };

  // パスコードを発行して保存（失敗したら、いま作った人を全員取り消す）
  try {
    const out: BulkStaffResult[] = [];
    const passcodes = rows.map(() => generatePasscode());
    const hashes = await Promise.all(passcodes.map((p) => hashPasscode(p)));
    await db.tx(async (q) => { for (const [i, id] of ids.entries()) await q.query("update memberships set passcode_hash = $2 where id = $1", [id, hashes[i]]); });
    rows.forEach((r, i) => out.push({ name: r.name.trim(), employeeCode: r.employeeCode, storeId: r.storeId, level: r.displayOnly ? 1 : r.level, displayOnly: !!r.displayOnly, passcode: passcodes[i] }));
    return { count: rows.length, created: out };
  } catch {
    await db.query("delete from audit_logs where target_id = any($1::uuid[])", [ids]).catch(() => {});
    await db.query("delete from memberships where id = any($1::uuid[])", [ids]).catch(() => {});
    throw new Error("パスコードを作れなかったため、登録を取り消しました。もう一度お試しください");
  }
}
