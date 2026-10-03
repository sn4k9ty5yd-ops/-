import { issuePasscode } from "./auth/login";
import { upcomingPeriods } from "./periods";
import { asUser } from "./db/user-context";
import type { Database } from "./db/types";
import type { Level } from "./permissions";

// 画面(API)から呼ばれる業務処理。権限の判定はすべてDB側(RLS)で行い、ここでは再実装しない。

export interface Me { id: string; name: string; level: Level; storeId: string; companyId: string; companyName: string; closingStartDay: number; }
export interface StoreRow { id: string; name: string; status: "active" | "closed"; defaultOpen: string; defaultClose: string; }
export interface StaffRow {
  id: string; name: string; employeeCode: string; storeId: string; level: Level; status: "active" | "disabled"; manageable: boolean; onShift: boolean;
}

export class ForbiddenError extends Error {
  constructor(message = "この操作をする権限がありません") { super(message); }
}

export async function getMe(db: Database, userId: string): Promise<Me | null> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query<Me>(
      `select m.id, m.name, m.level, m.store_id as "storeId", m.company_id as "companyId", c.name as "companyName", c.closing_start_day as "closingStartDay"
         from memberships m join companies c on c.id = m.company_id where m.id = $1`, [userId]),
  );
  return rows[0] ?? null;
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
      `select id, name, employee_code as "employeeCode", store_id as "storeId", level, status, on_shift as "onShift" from memberships order by store_id, level desc, name`));
  // 「操作できる人」かは、画面のボタン表示のための目安（本当の判定はDBが行う）
  return rows.map((r) => ({
    ...r,
    manageable: me.level === 4 || (me.level === 3 && r.storeId === me.storeId && r.level < me.level),
  }));
}

/** スタッフ登録。パスコードを発行して返す（このときだけ見られる） */
export async function addStaff(
  db: Database, userId: string,
  input: { name: string; employeeCode: string; storeId: string; level: Level },
): Promise<{ id: string; passcode: string }> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  let id: string;
  try {
    id = (await asUser(db, userId, (q) =>
      q.query<{ id: string }>(
        `insert into memberships (company_id, store_id, employee_code, name, level) values ($1,$2,$3,$4,$5) returning id`,
        [me.companyId, input.storeId, input.employeeCode.trim(), input.name.trim(), input.level]))).rows[0].id;
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

/** パスコードの再発行（忘れたとき）。新しいパスコードを返す */
export async function reissuePasscode(db: Database, userId: string, targetId: string): Promise<string> {
  await assertCanManage(db, userId, targetId);
  return issuePasscode(db, targetId);
}

// ------------------------------------------------------------------ シフト期間・希望休

export type PeriodStatus = "preparing" | "collecting" | "closed" | "drafting" | "confirmed" | "published" | "submitted" | "acknowledged";
export const STATUS_ORDER: PeriodStatus[] = ["preparing", "collecting", "closed", "drafting", "confirmed", "published", "submitted", "acknowledged"];
export const STATUS_LABEL: Record<PeriodStatus, string> = {
  preparing: "準備中", collecting: "希望休受付中", closed: "受付終了", drafting: "シフト作成中",
  confirmed: "確定", published: "公開済み", submitted: "オフィスに提出済み", acknowledged: "確認済み",
};

export interface PeriodRow {
  id: string; label: string; start: string; end: string;
  stores: { storeId: string; status: PeriodStatus; openAt: string | null; closeAt: string | null }[];
}
export interface RequestRow { id: string; membershipId: string; storeId: string; periodId: string; day: string; kind: string; }

export async function listPeriods(db: Database, userId: string): Promise<PeriodRow[]> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query<{ id: string; label: string; start: string; end: string; storeId: string | null; status: PeriodStatus | null; openAt: string | null; closeAt: string | null }>(
      `select p.id, p.label, p.start_date::text as start, p.end_date::text as "end",
              sp.store_id as "storeId", sp.status, sp.request_open_at::text as "openAt", sp.request_close_at::text as "closeAt"
         from shift_periods p
         left join store_period_status sp on sp.period_id = p.id
         left join stores st on st.id = sp.store_id
        order by p.start_date desc, st.sort_order, st.name`));
  const map = new Map<string, PeriodRow>();
  for (const r of rows) {
    const p = map.get(r.id) ?? { id: r.id, label: r.label, start: r.start, end: r.end, stores: [] };
    if (r.storeId && r.status) p.stores.push({ storeId: r.storeId, status: r.status, openAt: r.openAt, closeAt: r.closeAt });
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
