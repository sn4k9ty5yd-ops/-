import { createHash } from "node:crypto";
import { issuePasscode } from "./auth/login";
import { generatePasscode, hashPasscode } from "./auth/passcode";
import { calcHours, DEFAULT_BREAK_RULE, validateBreakRule, type BreakRule } from "./hours";
import { periodFor, upcomingPeriods } from "./periods";
import { asUser } from "./db/user-context";
import type { Database, Queryable } from "./db/types";
import type { RegisterRow } from "./register-sales";
import { daysOf, hoursOn, md, shortNames } from "./labels";
import { pushToUsers, vapidKeys } from "./push";
import type { Level } from "./permissions";

// 画面(API)から呼ばれる業務処理。権限の判定はすべてDB側(RLS)で行い、ここでは再実装しない。

export interface Me { mustChangePasscode?: boolean; id: string; name: string; level: Level; storeId: string; companyId: string; companyName: string; closingStartDay: number; breakRule: BreakRule; displayOnly: boolean; materialManager?: boolean; appOwner?: boolean; rank?: "assistant" | "stylist" | null; eduLead?: boolean; }
export interface StoreRow { id: string; name: string; status: "active" | "closed"; defaultOpen: string; defaultClose: string; satOpen: string | null; satClose: string | null; }
/** 管理者だけが見られる、ログインの状況 */
export type Presence = "online" | "idle" | "loggedout" | "never";
export const ONLINE_SECONDS = 120; // これ以内に開いていれば「オンライン」
export interface StaffRow {
  presence?: Presence; seenAgoSec?: number | null; retireOn?: string | null;
  id: string; name: string; employeeCode: string; storeId: string; level: Level; status: "active" | "disabled"; manageable: boolean; onShift: boolean; displayOnly: boolean; canEvaluate?: boolean; materialManager?: boolean; eduLead?: boolean; appOwner?: boolean; rank?: "assistant" | "stylist" | null; shortName?: string | null;
}

export class ForbiddenError extends Error {
  constructor(message = "この操作をする権限がありません") { super(message); }
}

export async function getMe(db: Database, userId: string): Promise<Me | null> {
  const { rows } = await asUser(db, userId, (q) =>
    q.query<Omit<Me, "breakRule"> & { cap: number | null; tiers: { overMinutes: number; breakMinutes: number }[] }>(
      `select m.id, m.name, m.level, m.store_id as "storeId", m.company_id as "companyId", c.name as "companyName", c.closing_start_day as "closingStartDay",
              c.work_cap_minutes as cap, c.break_tiers as tiers, m.display_only as "displayOnly", m.material_manager as "materialManager", m.app_owner as "appOwner", m.rank as rank, m.edu_lead as "eduLead", m.passcode_must_change as "mustChangePasscode"
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
  return (await asUser(db, userId, (q) => q.query<StoreRow>(`select id, name, status, to_char(default_open, 'HH24:MI') as "defaultOpen", to_char(default_close, 'HH24:MI') as "defaultClose", to_char(sat_open, 'HH24:MI') as "satOpen", to_char(sat_close, 'HH24:MI') as "satClose" from stores order by status, sort_order, name`))).rows;
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
      `select id, name, employee_code as "employeeCode", store_id as "storeId", level, status, on_shift as "onShift", display_only as "displayOnly", app_owner as "appOwner", can_evaluate as "canEvaluate", material_manager as "materialManager", edu_lead as "eduLead", rank, short_name as "shortName" from memberships order by store_id, level desc, name`));
  // ログインの状況は管理者(Lv4)だけに見せる（管理用接続で読む）
  const pres = new Map<string, { presence: Presence; seenAgoSec: number | null; retireOn: string | null }>();
  if (me.level === 4 && rows.length > 0) {
    await applyScheduledRetirements(db);
    const p = await db.query<{ id: string; ever: boolean; has_session: boolean; ago: number | null; retire_on: string | null }>(
      `select m.id, (m.last_login_at is not null) as ever, m.retire_on::text as retire_on,
              exists (select 1 from sessions s where s.membership_id = m.id and s.expires_at > now()) as has_session,
              extract(epoch from (now() - m.last_seen_at))::float8 as ago
         from memberships m where m.id = any($1::uuid[])`, [rows.map((r) => r.id)]);
    for (const r of p.rows) {
      const ago = r.ago === null ? null : Number(r.ago);
      const presence: Presence = !r.ever && !r.has_session ? "never"
        : r.has_session && ago !== null && ago <= ONLINE_SECONDS ? "online"
        : r.has_session ? "idle" : "loggedout";
      pres.set(r.id, { presence, seenAgoSec: ago, retireOn: r.retire_on });
    }
  }
  // 「操作できる人」かは、画面のボタン表示のための目安（本当の判定はDBが行う）。社員番号の小さい順に並べる
  return rows.map((r) => ({
    ...r,
    ...(pres.get(r.id) ?? {}),
    manageable: (me.level === 4 || (me.level === 3 && r.storeId === me.storeId && r.level < me.level)) && (!r.appOwner || r.id === userId),
  })).sort(compareEmployeeCode);
}

/** 社員番号の小さい順（数字は数として比べる。数字でないものは最後） */
export function compareEmployeeCode(a: { employeeCode: string }, b: { employeeCode: string }): number {
  const na = /^\d+/.exec(a.employeeCode), nb = /^\d+/.exec(b.employeeCode);
  if (na && nb) { const d = Number(na[0]) - Number(nb[0]); if (d !== 0) return d; }
  else if (na) return -1; else if (nb) return 1;
  return a.employeeCode.localeCompare(b.employeeCode, "ja");
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
  await assertNotOwnerTarget(db, userId, targetId);
  const { rows } = await asUser(db, userId, (q) => q.query("update memberships set name = name where id = $1 returning id", [targetId]));
  if (rows.length === 0) throw new ForbiddenError();
  await assertNotOwnerTarget(db, userId, targetId);
}

/** アプリ制作者の行は、本人以外（オフィスでも）は変えられない */
async function assertNotOwnerTarget(db: Database, userId: string, targetId: string) {
  if (targetId === userId) return;
  const r = await asUser(db, userId, (q) => q.query<{ o: boolean }>("select app_owner as o from memberships where id = $1", [targetId]));
  if (r.rows[0]?.o) throw new ForbiddenError("この人は、アプリ制作者です。ほかの人は変更できません");
}

export async function disableStaff(db: Database, userId: string, targetId: string): Promise<void> {
  if (targetId === userId) {
    // 自分を退職にできるのは、ほかに有効な管理者がいるときだけ（だれもログインできなくなるのを防ぐ）
    const other = await db.query("select 1 from memberships where level = 4 and status = 'active' and id <> $1 and company_id = (select company_id from memberships where id = $1) limit 1", [userId]);
    if (other.rows.length === 0) throw new Error("ほかに有効な管理者がいないので、自分は退職にできません");
  }
  const { rows } = await asUser(db, userId, (q) =>
    q.query("update memberships set status = 'disabled', left_on = current_date where id = $1 returning id", [targetId]));
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

/** 名前・社員番号の変更（管理者のみ。自分自身も可）。ログイン中の端末はそのまま使える */
export async function updateStaffProfile(db: Database, userId: string, targetId: string, input: { name?: string; employeeCode?: string; shortName?: string | null }): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  if (input.shortName !== undefined) {
    const sn = (input.shortName ?? "").trim();
    if (sn.length > 6) throw new Error("短い名前は、6文字までにしてください");
    try { await asUser(db, userId, (q) => q.query("update memberships set short_name = $2 where id = $1", [targetId, sn || null])); } catch { throw new ForbiddenError(); }
    if (input.name === undefined && input.employeeCode === undefined) return;
  }
  const name = input.name?.trim(), code = input.employeeCode?.trim();
  if (name === "" ) throw new Error("名前を入れてください");
  if (code !== undefined && !/^[A-Za-z0-9]{1,20}$/.test(code)) throw new Error("社員番号は、英数字（20文字まで）にしてください");
  if (name === undefined && code === undefined) throw new Error("変える内容がありません");
  try {
    const r = await asUser(db, userId, (q) =>
      q.query("update memberships set name = coalesce($2, name), employee_code = coalesce($3, employee_code) where id = $1 returning id", [targetId, name ?? null, code ?? null]));
    if (r.rows.length === 0) throw new ForbiddenError();
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("その社員番号はすでに使われています");
    throw e instanceof ForbiddenError || e instanceof Error && e.message.includes("社員番号") ? e : new ForbiddenError();
  }
}

/** 退職予定日を決める／消す（管理者のみ）。その日になると自動で退職（無効）扱いになる */
export async function setRetireDate(db: Database, userId: string, targetId: string, date: string | null): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日付が正しくありません");
  const visible = await asUser(db, userId, (q) => q.query("select 1 from memberships where id = $1 and status = 'active'", [targetId]));
  if (visible.rows.length === 0) throw new ForbiddenError();
  await assertNotOwnerTarget(db, userId, targetId);
  if (date !== null) {
    const other = await db.query(
      `select 1 from memberships t join memberships o on o.company_id = t.company_id
        where t.id = $1 and t.level = 4 and o.level = 4 and o.status = 'active' and o.id <> t.id and o.retire_on is null limit 1`, [targetId]);
    const isAdmin = (await db.query("select 1 from memberships where id = $1 and level = 4", [targetId])).rows.length > 0;
    if (isAdmin && other.rows.length === 0) throw new Error("ほかに有効な管理者がいないので、この人の退職予定日は決められません");
  }
  await db.query("update memberships set retire_on = $2 where id = $1", [targetId, date]);
  await applyScheduledRetirements(db, true);
}

let lastRetireRun = 0;
/** 退職予定日になった人を、自動で退職（無効）にする。リクエストのついでに1分に1回だけ確認する */
export async function applyScheduledRetirements(db: Database, force = false): Promise<number> {
  if (!force && Date.now() - lastRetireRun < 60_000) return 0;
  lastRetireRun = Date.now();
  const { rows } = await db.query<{ id: string }>(
    `update memberships m set status = 'disabled', left_on = m.retire_on
      where m.status = 'active' and m.retire_on is not null and m.retire_on <= (now() at time zone 'Asia/Tokyo')::date
        and (m.level < 4 or exists (select 1 from memberships o where o.company_id = m.company_id and o.level = 4 and o.status = 'active' and o.id <> m.id
                                      and (o.retire_on is null or o.retire_on > (now() at time zone 'Asia/Tokyo')::date)))
      returning m.id`);
  if (rows.length > 0) await db.query("delete from sessions where membership_id = any($1::uuid[])", [rows.map((r) => r.id)]);
  return rows.length;
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
  preparing: "準備中", collecting: "希望休受付中", closed: "受付終了", drafting: "出勤簿づくり中",
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

/** シフト担当（Lv2以上）が押す「次のシフトを作る」。次の期間がまだ無ければ作る（あれば何もしない）。作った期間の名前を返す */
export async function ensureNextPeriod(db: Database, userId: string, today: string): Promise<{ created: boolean; label: string }> {
  const me = await getMe(db, userId);
  if (!me || me.level < 2) throw new ForbiddenError();
  const startDay = (await db.query<{ d: number }>("select closing_start_day as d from companies where id = $1", [me.companyId])).rows[0].d;
  const cur = periodFor(today, startDay);
  // 「いまの期間」より先の期間がすでにあれば、新しくは作らない（押し間違い・二重作成の防止）
  const ahead = (await db.query<{ label: string }>(
    "select label from shift_periods where company_id = $1 and start_date > $2 order by start_date limit 1", [me.companyId, cur.start])).rows[0];
  if (ahead) return { created: false, label: ahead.label };
  const last = (await db.query<{ e: string | null }>("select max(end_date)::text as e from shift_periods where company_id = $1", [me.companyId])).rows[0].e;
  let from = today;
  if (last) { const d = new Date(last + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); from = d.toISOString().slice(0, 10); }
  const p = upcomingPeriods(from, startDay, 1)[0];
  const id = (await db.query<{ id: string }>(
    "insert into shift_periods (company_id, start_date, end_date, label) values ($1,$2,$3,$4) returning id", [me.companyId, p.start, p.end, p.label])).rows[0].id;
  await db.query("insert into store_period_status (period_id, store_id, company_id) select $1, id, company_id from stores where status = 'active' and company_id = $2", [id, me.companyId]);
  return { created: true, label: p.label };
}

export async function setPeriodStatus(
  db: Database, userId: string,
  input: { periodId: string; storeId: string; status?: PeriodStatus; openAt?: string | null; closeAt?: string | null; force?: boolean },
): Promise<void> {
  if (input.status && !STATUS_ORDER.includes(input.status)) throw new Error("状態が正しくありません");
  if (input.status === "confirmed" && !input.force) {
    const cs = await listConflicts(db, userId, input.periodId, input.storeId).catch(() => []);
    if (cs.length > 0) throw new Error(`休みがかぶっている日があります（${cs.slice(0, 6).map((c) => `${jpDay(c.day)} ${c.count}人／上限${c.maxOff}人`).join("、")}${cs.length > 6 ? " ほか" : ""}）。先に、かぶっている人に知らせて、話し合ってください。`);
  }
  // 「出勤簿づくり」より前から進めるときだけ、自動の下書きを入れる（ひとつ戻したときは、入っている内容をそのままにする）
  const before = input.status === "drafting"
    ? (await asUser(db, userId, (q) => q.query<{ s: PeriodStatus }>("select status as s from store_period_status where period_id = $1 and store_id = $2", [input.periodId, input.storeId]))).rows[0]?.s
    : undefined;
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
  if (input.status === "drafting" && before && STATUS_ORDER.indexOf(before) < STATUS_ORDER.indexOf("drafting")) await autoDraftShifts(db, userId, input.periodId, input.storeId).catch(() => 0);   // 出勤簿づくりを始めたら、シフトカレンダーの内容を自動で反映
  if (input.status === "published") await notifyShiftPublished(db, input.periodId, input.storeId).catch(() => 0);   // 通知が失敗しても、公開は成功
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

/** 自分の希望休を、公休(hope)か有給(paid)で出す。kind が null なら、取り消す（受付中のみ。ルールはDBが判定） */
export async function setMyRequest(db: Database, userId: string, periodId: string, day: string, kind: "hope" | "paid" | null): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  if (me.displayOnly) throw new Error("このアカウントは、見るだけです（希望休は出せません）");
  try {
    await asUser(db, userId, async (q) => {
      await q.query("delete from time_off_requests where membership_id = $1 and period_id = $2 and day = $3", [userId, periodId, day]);
      if (kind) await q.query(
        "insert into time_off_requests (company_id, membership_id, store_id, period_id, day, kind) values ($1,$2,$3,$4,$5,$6)",
        [me.companyId, userId, me.storeId, periodId, day, kind]);
    });
  } catch { throw new Error("いまは希望休を変更できません（受付期間外、または期間外の日付です）"); }
}

export async function listNames(db: Database, userId: string): Promise<{ id: string; name: string; storeId: string; shortName: string | null }[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ id: string; name: string; storeId: string; shortName: string | null }>(
      `select id, name, store_id as "storeId", short_name as "shortName" from memberships where status = 'active' and on_shift order by store_id, level desc, name`))).rows;
}


// ------------------------------------------------------------------ シフト
export type ShiftKind = "work" | "off" | "paid" | "holiday" | "other";
export interface ShiftRow { id: string; membershipId: string; storeId: string; periodId: string; day: string; kind: ShiftKind; start: string | null; end: string | null; }
export interface ShiftEntry { membershipId: string; day: string; kind: ShiftKind; start?: string | null; end?: string | null; }
export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = { work: "出勤", off: "休み", paid: "有給", holiday: "公休", other: "その他" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS: ShiftKind[] = ["work", "off", "paid", "holiday", "other"];

export async function setStoreHours(db: Database, userId: string, storeId: string, open: string, close: string, sat?: { open: string; close: string } | null): Promise<void> {
  if (!TIME.test(open) || !TIME.test(close) || close <= open) throw new Error("オープンとクローズの時間が正しくありません");
  if (sat && (!TIME.test(sat.open) || !TIME.test(sat.close) || sat.close <= sat.open)) throw new Error("土曜日のオープンとクローズの時間が正しくありません");
  let n = 0;
  try { n = (await asUser(db, userId, (q) => q.query("update stores set default_open = $2, default_close = $3, sat_open = $4, sat_close = $5 where id = $1 returning id", [storeId, open, close, sat?.open ?? null, sat?.close ?? null]))).rows.length; }
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
export async function listRoster(db: Database, userId: string, storeId: string): Promise<{ id: string; name: string; level: Level; shortName: string | null }[]> {
  return (await asUser(db, userId, (q) =>
    q.query<{ id: string; name: string; level: Level; shortName: string | null }>(
      "select id, name, level, short_name as \"shortName\" from memberships where store_id = $1 and status = 'active' and on_shift order by level desc, name", [storeId]))).rows;
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
              case r.kind when 'paid' then 'paid' when 'other' then 'other' else 'holiday' end
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
  input: { periodId: string; storeId: string; days: string[]; membershipIds?: string[]; start: string; end: string; overwrite?: boolean; keepOff?: boolean },
): Promise<number> {
  if (!TIME.test(input.start) || !TIME.test(input.end) || input.end <= input.start) throw new Error("入店と退店の時間が正しくありません");
  const roster = (await listRoster(db, userId, input.storeId)).map((r) => r.id).filter((id) => !input.membershipIds || input.membershipIds.includes(id));
  const existingRows = await listShifts(db, userId, input.periodId, input.storeId);
  const existing = new Set(existingRows.map((s) => `${s.membershipId}|${s.day}`));
  const offCells = new Set(existingRows.filter((s) => s.kind !== "work").map((s) => `${s.membershipId}|${s.day}`));
  const reqs = new Map((await listRequests(db, userId, input.periodId)).map((r) => [`${r.membershipId}|${r.day}`, r.kind]));
  const entries: ShiftEntry[] = [];
  for (const day of input.days) for (const id of roster) {
    const k = `${id}|${day}`;
    if (!input.overwrite && existing.has(k)) continue;
    if (input.overwrite && input.keepOff && offCells.has(k)) continue;   // 休み・有給の人は、そのまま
    const req = reqs.get(k);
    entries.push(req ? { membershipId: id, day, kind: req === "paid" ? "paid" : "holiday" } : { membershipId: id, day, kind: "work", start: input.start, end: input.end });
  }
  return saveShifts(db, userId, input.periodId, input.storeId, entries);
}


/**
 * シフトカレンダー（希望休・有給）の内容を、出勤簿に全部まとめて反映する。
 * 休み・有給は希望どおり、ほかの日は、お店の営業時間（土曜は土曜の時間）で出勤にする。すでに入っている人・日は変えない。
 */
export async function autoDraftShifts(db: Database, userId: string, periodId: string, storeId: string): Promise<number> {
  if (!(await canEditShifts(db, userId, periodId, storeId))) throw new ForbiddenError(NOT_EDITABLE);
  const per = (await asUser(db, userId, (q) => q.query<{ s: string; e: string }>("select start_date::text as s, end_date::text as e from shift_periods where id = $1", [periodId]))).rows[0];
  const store = (await listStores(db, userId)).find((x) => x.id === storeId);
  if (!per || !store) throw new ForbiddenError();
  let n = await applyRequests(db, userId, periodId, storeId);
  const groups = new Map<string, string[]>();
  for (const d of daysOf(per.s, per.e)) { const h = hoursOn(store, d); const k = `${h.start}-${h.end}`; groups.set(k, [...(groups.get(k) ?? []), d]); }
  for (const [k, days] of groups) { const [start, end] = k.split("-"); n += await fillDefault(db, userId, { periodId, storeId, days, start, end }); }
  return n;
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

/** 商品をまとめて登録（Excelの貼り付け・画像の読み込みにも使う）。同じ商品がすでにあれば飛ばす。店長(Lv3)・事務員さん(Lv4)が登録できる */
export async function createProducts(db: Database, userId: string, kind: ProductKind, items: ProductInput[], storeIds: string[]): Promise<{ created: number; skipped: number }> {
  if (!["retail", "supply"].includes(kind)) throw new Error("種類が正しくありません");
  items.forEach(checkProduct);
  if (storeIds.length === 0) throw new Error("使うお店を1つ以上えらんでください");
  const me = await getMe(db, userId);
  if (!me || me.level < 3) throw new ForbiddenError();
  try {
    const r = await asUser(db, userId, (q) => q.query<{ r: { created: number; skipped: number } }>("select public.product_create($1, $2::jsonb, $3::uuid[]) as r", [kind, JSON.stringify(items), storeIds]));
    return r.rows[0].r;
  } catch (e) { if (e instanceof Error && /bad item/.test(e.message)) throw new Error("商品の内容が正しくありません"); throw new ForbiddenError(); }
}

/** このお店で使う／使わない（店長は自店、事務員さんは全店）。商品そのものは消えない */
export async function setProductStoreUse(db: Database, userId: string, productId: string, storeId: string, on: boolean): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 3) throw new ForbiddenError();
  try { await asUser(db, userId, (q) => q.query("select public.product_store_set($1, $2, $3)", [productId, storeId, on])); }
  catch { throw new ForbiddenError(); }
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

/** 全体から消す（取扱い終了）／再開する。事務員さんだけ。商品も過去の棚卸しも消えない */
export async function setProductStatus(db: Database, userId: string, id: string, status: "active" | "discontinued"): Promise<void> {
  if (status !== "active" && status !== "discontinued") throw new Error("状態が正しくありません");
  let n = 0;
  try { n = (await asUser(db, userId, (q) => q.query("update products set status = $2 where id = $1 returning id", [id, status]))).rows.length; }
  catch { throw new ForbiddenError(); }
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


// ------------------------------------------------------------------ マニュアル
import type { Block } from "./manual/blocks";
export interface ManualPageRow { id: string; parentId: string | null; title: string; icon: string; sortOrder: number; minLevel: number; editLevel: number; storeId: string | null; ownerId: string | null; evaluatorsEdit: boolean; viewRanks: string[]; editRanks: string[]; }
export interface ManualGrant { membershipId: string; name: string; canEdit: boolean; }
export interface ManualPage extends ManualPageRow { canEdit: boolean; grants?: ManualGrant[]; log: { at: string; by: string | null; summary: string }[]; body: Block[]; refs: Record<string, { id: string; title: string; icon: string }>; trail: { id: string; title: string }[]; children: ManualPageRow[]; }

const MANUAL_COLS = `id, parent_id as "parentId", title, icon, sort_order as "sortOrder", min_level as "minLevel", edit_level as "editLevel", store_id as "storeId", owner_id as "ownerId", evaluators_edit as "evaluatorsEdit", view_ranks as "viewRanks", edit_ranks as "editRanks"`;

/** 見られるページの一覧（中身は含まない）。キーワードがあれば、題名と本文から探す */
export async function listManualPages(db: Database, userId: string, q?: string): Promise<ManualPageRow[]> {
  const kw = q?.trim();
  return (await asUser(db, userId, (c) =>
    kw
      ? c.query<ManualPageRow>(`select ${MANUAL_COLS} from manual_pages where title ilike $1 or body::text ilike $1 order by (title ilike $1) desc, sort_order, title limit 100`, [`%${kw.replace(/[%_\\]/g, "\\$&")}%`])
      : c.query<ManualPageRow>(`select ${MANUAL_COLS} from manual_pages order by sort_order, title`))).rows;
}

export async function getManualPage(db: Database, userId: string, id: string): Promise<ManualPage> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ForbiddenError("ページが見つかりません");
  return asUser(db, userId, async (c) => {
    const r = (await c.query<ManualPageRow & { body: Block[] }>(`select ${MANUAL_COLS}, body from manual_pages where id = $1`, [id])).rows[0];
    if (!r) throw new ForbiddenError("ページが見つかりません、または見る権限がありません");
    const trail = (await c.query<{ id: string; title: string }>(
      `with recursive up as (select id, parent_id, title, 0 as d from manual_pages where id = $1
         union all select p.id, p.parent_id, p.title, up.d + 1 from manual_pages p join up on p.id = up.parent_id where up.d < 12)
       select id, title from up where id <> $1 order by d desc`, [id])).rows;
    const children = (await c.query<ManualPageRow>(`select ${MANUAL_COLS} from manual_pages where parent_id = $1 order by sort_order, title`, [id])).rows;
    const keys = [...new Set((JSON.stringify(r.body).replace(/-/g, "").match(/[0-9a-f]{32}/g) ?? []))];
    const refs: ManualPage["refs"] = {};
    if (keys.length) {
      for (const x of (await c.query<{ source_id: string; id: string; title: string; icon: string }>(
        "select source_id, id, title, icon from manual_pages where source_id = any($1::text[])", [keys])).rows) refs[x.source_id] = { id: x.id, title: x.title, icon: x.icon };
    }
    const canEdit = (await c.query<{ ok: boolean }>("select app.manual_can_edit($1) as ok", [id])).rows[0].ok;
    const log = canEdit
      ? (await c.query<{ at: string; by: string | null; summary: string }>(
          `select to_char(l.at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as at, (select m.name from memberships m where m.id = l.user_id) as by, l.summary
             from manual_edit_log l where l.page_id = $1 order by l.at desc, l.id desc limit 30`, [id])).rows
      : [];
    const me = (await c.query<{ level: number }>("select level from memberships where id = app.uid()")).rows[0];
    const grants = me && me.level >= 4
      ? (await c.query<ManualGrant>(`select g.membership_id as "membershipId", m.name, g.can_edit as "canEdit" from manual_page_grants g join memberships m on m.id = g.membership_id where g.page_id = $1 order by m.name`, [id])).rows
      : undefined;
    return { ...r, refs, trail, children, canEdit, log, grants };
  });
}

export interface ManualSettings { title?: string; icon?: string; minLevel?: number; editLevel?: number; sortOrder?: number; storeId?: string | null; ownerId?: string | null; evaluatorsEdit?: boolean; viewRanks?: string[]; editRanks?: string[]; }
const RANKS = ["assistant", "stylist"];
export async function updateManualPage(db: Database, userId: string, id: string, input: ManualSettings): Promise<void> {
  if (input.minLevel !== undefined && ![1, 2, 3, 4].includes(input.minLevel)) throw new Error("レベルが正しくありません");
  if (input.editLevel !== undefined && ![1, 2, 3, 4].includes(input.editLevel)) throw new Error("レベルが正しくありません");
  if (input.title !== undefined && !input.title.trim()) throw new Error("題名を入れてください");
  for (const rs of [input.viewRanks, input.editRanks]) if (rs && rs.some((r) => !RANKS.includes(r))) throw new Error("ランクが正しくありません");
  let n = 0;
  try {
    n = (await asUser(db, userId, (c) => c.query(
      `update manual_pages set title = coalesce($2, title), icon = coalesce($3, icon), min_level = coalesce($4, min_level), sort_order = coalesce($5, sort_order),
         edit_level = coalesce($6, edit_level),
         store_id = case when $7::boolean then $8::uuid else store_id end,
         owner_id = case when $9::boolean then $10::uuid else owner_id end,
         evaluators_edit = coalesce($11, evaluators_edit), view_ranks = coalesce($12::text[], view_ranks), edit_ranks = coalesce($13::text[], edit_ranks), updated_at = now() where id = $1 returning id`,
      [id, input.title?.trim() ?? null, input.icon ?? null, input.minLevel ?? null, input.sortOrder ?? null, input.editLevel ?? null,
       input.storeId !== undefined, input.storeId ?? null, input.ownerId !== undefined, input.ownerId ?? null, input.evaluatorsEdit ?? null, input.viewRanks ?? null, input.editRanks ?? null]))).rows.length;
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** ページの「見られる・書き込める人」の設定を、その下のページ全部にもまとめて設定する */
export async function setManualLevelDeep(db: Database, userId: string, id: string, s: { minLevel: number; editLevel: number; evaluatorsEdit: boolean; storeId: string | null; viewRanks: string[]; editRanks: string[] }): Promise<number> {
  if ([...s.viewRanks, ...s.editRanks].some((r) => !RANKS.includes(r))) throw new Error("ランクが正しくありません");
  if (![1, 2, 3, 4].includes(s.minLevel) || ![1, 2, 3, 4].includes(s.editLevel)) throw new Error("レベルが正しくありません");
  const r = await asUser(db, userId, (c) => c.query(
    `with recursive down as (select id from manual_pages where id = $1 union all select p.id from manual_pages p join down on p.parent_id = down.id)
     update manual_pages set min_level = $2, edit_level = $3, evaluators_edit = $4, store_id = $5, view_ranks = $6::text[], edit_ranks = $7::text[], updated_at = now() where id in (select id from down) returning id`,
    [id, s.minLevel, s.editLevel, s.evaluatorsEdit, s.storeId, s.viewRanks, s.editRanks]));
  if (r.rows.length === 0) throw new ForbiddenError();
  return r.rows.length;
}

export async function deleteManualPage(db: Database, userId: string, id: string): Promise<void> {
  let n = 0;
  try { n = (await asUser(db, userId, (c) => c.query("delete from manual_pages where id = $1 returning id", [id]))).rows.length; } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

export async function getManualAsset(db: Database, userId: string, id: string): Promise<{ mime: string; name: string; data: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = (await asUser(db, userId, (c) => c.query<{ mime: string; name: string; data: Uint8Array }>("select mime, name, data from manual_assets where id = $1", [id]))).rows[0];
  return r ? { mime: r.mime, name: r.name, data: Buffer.from(r.data) } : null;
}

import { applyOp, type EditOp } from "./manual/edit";
/** ページへの書き込み（チェック・表のマス）。権限はDBが確かめる。同時に書き込んでも消し合わないよう、ページごとに順番に処理する */
export async function editManualBlock(db: Database, userId: string, pageId: string, op: EditOp): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(pageId)) throw new ForbiddenError();
  await asUser(db, userId, async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [pageId]);
    const row = (await c.query<{ body: Block[] }>("select body from manual_pages where id = $1", [pageId])).rows[0];
    if (!row) throw new ForbiddenError("ページが見つかりません、または見る権限がありません");
    const { body, summary } = applyOp(row.body, op);
    try { await c.query("select app.manual_write_body($1, $2::jsonb, $3)", [pageId, JSON.stringify(body), summary]); }
    catch (e) { if ((e as { code?: string }).code === "42501") throw new ForbiddenError("このページには書き込めません"); throw e; }
  });
}

/** 技術評価をつけられる人にする／外す（管理者のみ） */
export async function setCanEvaluate(db: Database, userId: string, targetId: string, on: boolean): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  const ok = await asUser(db, userId, (q) => q.query("select 1 from memberships where id = $1 and status = 'active'", [targetId]));
  if (ok.rows.length === 0) throw new ForbiddenError();
  await db.query("update memberships set can_evaluate = $2 where id = $1", [targetId, on]);
}

/** 名前で、見られる人（と書き込める人）を追加／変更／外す（管理者のみ） */
export async function setManualGrant(db: Database, userId: string, pageId: string, membershipId: string, mode: "view" | "edit" | "remove"): Promise<void> {
  try {
    await asUser(db, userId, async (c) => {
      if (mode === "remove") { await c.query("delete from manual_page_grants where page_id = $1 and membership_id = $2", [pageId, membershipId]); return; }
      await c.query(
        `insert into manual_page_grants (page_id, membership_id, can_edit) values ($1,$2,$3)
         on conflict (page_id, membership_id) do update set can_edit = excluded.can_edit`, [pageId, membershipId, mode === "edit"]);
    });
  } catch { throw new ForbiddenError(); }
}

/** ランク（アシスタント／スタイリスト）を決める（管理者のみ）。空にもできる */
export async function setRank(db: Database, userId: string, targetId: string, rank: string | null): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  if (rank !== null && !RANKS.includes(rank)) throw new Error("ランクが正しくありません");
  const ok = await asUser(db, userId, (q) => q.query("select 1 from memberships where id = $1 and status = 'active'", [targetId]));
  if (ok.rows.length === 0) throw new ForbiddenError();
  await db.query("update memberships set rank = $2 where id = $1", [targetId, rank]);
}


// ------------------------------------------------------------------ 休みの上限・かぶりの知らせ・話し合い
const jpDay = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${"日月火水木金土"[d.getUTCDay()]}）`; };
export interface DayLimit { day: string; maxOff: number }
export interface Conflict { day: string; maxOff: number; count: number }
export interface DayInfo {
  day: string; label: string; maxOff: number | null; people: { id: string; name: string; kind: string }[];
  messages: { id: number; userId: string; name: string; body: string; at: string }[]; canEdit: boolean;
}
export interface NotificationRow { id: string; kind: string; title: string; body: string; link: string | null; createdAt: string; read: boolean }

export async function listDayLimits(db: Database, userId: string, periodId: string, storeId: string): Promise<DayLimit[]> {
  return (await asUser(db, userId, (q) => q.query<DayLimit>(
    `select day::text as day, max_off as "maxOff" from day_limits where period_id = $1 and store_id = $2 order by day`, [periodId, storeId]))).rows;
}

/** 日ごとの「休みの上限（◯人まで）」を決める。null で、上限なしに戻す（シフトを作れる人だけ） */
export async function setDayLimits(db: Database, userId: string, periodId: string, storeId: string, days: string[], maxOff: number | null): Promise<number> {
  if (maxOff !== null && (!Number.isInteger(maxOff) || maxOff < 0 || maxOff > 99)) throw new Error("人数は、0〜99で入れてください");
  if (days.length === 0 || days.length > 62 || days.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("日付が正しくありません");
  try {
    return await asUser(db, userId, async (q) => {
      const per = (await q.query<{ ok: boolean; company_id: string }>("select true as ok, company_id from shift_periods where id = $1 and start_date <= all($2::date[]) and end_date >= all($2::date[])", [periodId, days])).rows[0];
      if (!per) throw new Error("期間の外の日付です");
      if (maxOff === null) { await q.query("delete from day_limits where period_id = $1 and store_id = $2 and day = any($3::date[])", [periodId, storeId, days]); return days.length; }
      for (const d of days) {
        await q.query(
          `insert into day_limits (period_id, store_id, company_id, day, max_off, updated_by) values ($1,$2,$3,$4,$5,$6)
           on conflict (period_id, store_id, day) do update set max_off = excluded.max_off, updated_at = now(), updated_by = excluded.updated_by`,
          [periodId, storeId, per.company_id, d, maxOff, userId]);
      }
      return days.length;
    });
  } catch (e) { if (e instanceof Error && e.message.includes("期間")) throw e; throw new ForbiddenError(); }
}

export async function listConflicts(db: Database, userId: string, periodId: string, storeId: string): Promise<Conflict[]> {
  return (await asUser(db, userId, (q) => q.query<Conflict>(
    `select day::text as day, max_off as "maxOff", cnt as count from app.period_conflicts($1, $2)`, [periodId, storeId]))).rows;
}

export async function getDayInfo(db: Database, userId: string, periodId: string, storeId: string, day: string): Promise<DayInfo> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("日付が正しくありません");
  return asUser(db, userId, async (q) => {
    const people = (await q.query<{ id: string; name: string; kind: string }>(
      `select p.membership_id as id, m.name, p.kind from app.day_off_people($1, $2, $3::date) p join memberships m on m.id = p.membership_id order by m.name`, [periodId, storeId, day])).rows;
    const canEdit = (await q.query<{ ok: boolean }>("select app.has_perm('shift.edit', $1) as ok", [storeId])).rows[0].ok;
    if (people.length === 0 && !canEdit) throw new ForbiddenError("この日の話し合いは見られません");
    const lim = (await q.query<{ m: number }>("select max_off as m from day_limits where period_id = $1 and store_id = $2 and day = $3::date", [periodId, storeId, day])).rows[0];
    const messages = (await q.query<{ id: number; userId: string; name: string; body: string; at: string }>(
      `select d.id::int as id, d.user_id as "userId", u.name, d.body, to_char(d.created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as at
         from day_messages d join memberships u on u.id = d.user_id
        where d.period_id = $1 and d.store_id = $2 and d.day = $3::date order by d.id`, [periodId, storeId, day])).rows;
    return { day, label: jpDay(day), maxOff: lim?.m ?? null, people, messages, canEdit };
  });
}

export async function postDayMessage(db: Database, userId: string, periodId: string, storeId: string, day: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("メッセージを入れてください");
  if (text.length > 500) throw new Error("メッセージは500文字までです");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, (q) => q.query(
      "insert into day_messages (company_id, period_id, store_id, day, user_id, body) values ($1,$2,$3,$4::date,$5,$6)", [me.companyId, periodId, storeId, day, userId, text]));
  } catch { throw new ForbiddenError("この日の話し合いには書き込めません"); }
  // 話し合いに参加している他の人に、お知らせ（まだ読んでいない同じ日のお知らせは、まとめる）
  const info = await getDayInfo(db, userId, periodId, storeId, day).catch(() => null);
  if (!info) return;
  const link = `/conflict?periodId=${periodId}&storeId=${storeId}&day=${day}`;
  const editors = (await db.query<{ id: string }>("select id from memberships where store_id = $1 and level >= 2 and status = 'active'", [storeId])).rows.map((r) => r.id);
  const targets = [...new Set([...info.people.map((p) => p.id), ...info.messages.map((m) => m.userId), ...editors])].filter((u) => u !== userId);
  await pushToUsers(db, targets, { title: `${jpDay(day)} の話し合いに、${me.name} さんが書き込みました`, body: text.slice(0, 80), url: link, tag: `msg-${link}` }).catch(() => 0);
  for (const uid of new Set([...info.people.map((p) => p.id), ...info.messages.map((m) => m.userId), ...editors])) {
    if (uid === userId) continue;
    await db.query("delete from notifications where user_id = $1 and link = $2 and kind = 'message' and read_at is null", [uid, link]);
    await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'message',$3,$4,$5)",
      [me.companyId, uid, `${jpDay(day)} の話し合いに、${me.name} さんが書き込みました`, text.slice(0, 80), link]);
  }
}

/** 休みの上限を超えた日の、その日に休みを希望している人たちに、お知らせを送る（day を指定すると、その日だけ） */
export async function notifyConflicts(db: Database, userId: string, periodId: string, storeId: string, day?: string): Promise<{ days: number; people: number }> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const can = (await asUser(db, userId, (q) => q.query<{ ok: boolean }>("select app.has_perm('shift.edit', $1) as ok", [storeId]))).rows[0].ok;
  if (!can) throw new ForbiddenError();
  const conflicts = (await listConflicts(db, userId, periodId, storeId)).filter((c) => !day || c.day === day);
  let people = 0;
  for (const c of conflicts) {
    const who = (await asUser(db, userId, (q) => q.query<{ id: string; name: string }>(
      `select p.membership_id as id, m.name from app.day_off_people($1, $2, $3::date) p join memberships m on m.id = p.membership_id`, [periodId, storeId, c.day]))).rows;
    const link = `/conflict?periodId=${periodId}&storeId=${storeId}&day=${c.day}`;
    for (const w of who) {
      await db.query("delete from notifications where user_id = $1 and link = $2 and kind = 'conflict' and read_at is null", [w.id, link]);
      await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'conflict',$3,$4,$5)",
        [me.companyId, w.id, `休みがかぶっています（${jpDay(c.day)}）`,
         `${jpDay(c.day)} は、休みの上限が ${c.maxOff} 人ですが、いま ${c.count} 人が休みを希望しています。希望している人：${who.map((x) => x.name).join("、")}。押して、話し合ってください。`, link]);
      people++;
    }
    await pushToUsers(db, who.map((w) => w.id), { title: `休みがかぶっています（${jpDay(c.day)}）`, body: `${jpDay(c.day)} は休みの上限 ${c.maxOff} 人に対して ${c.count} 人です。押して、話し合ってください。`, url: link, tag: `conflict-${c.day}` }).catch(() => 0);
  }
  return { days: conflicts.length, people };
}

export async function listNotifications(db: Database, userId: string): Promise<{ items: NotificationRow[]; unread: number }> {
  const items = (await asUser(db, userId, (q) => q.query<NotificationRow>(
    `select id, kind, title, body, link, to_char(created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "createdAt", (read_at is not null) as read
       from notifications order by created_at desc limit 60`))).rows;
  return { items, unread: items.filter((i) => !i.read).length };
}

export async function markNotificationsRead(db: Database, userId: string, ids?: string[]): Promise<void> {
  await asUser(db, userId, (q) => ids?.length
    ? q.query("update notifications set read_at = now() where read_at is null and id = any($1::uuid[])", [ids])
    : q.query("update notifications set read_at = now() where read_at is null"));
}


// ------------------------------------------------------------------ 材料費（発注した額）
export type MaterialKind = "supply" | "retail" | "other";
export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = { supply: "材料（業務）", retail: "店販", other: "その他" };
export interface MaterialOrder {
  id: string; storeId: string; orderedOn: string; supplier: string; item: string; kind: MaterialKind; amount: number; note: string; lines: MaterialLine[]; taxMode: "ex" | "in"; entered: number | null;
  by: string | null; at: string; deleted: boolean; edited: boolean;
}
export interface MaterialLogRow { id: number; orderId: string; action: string; by: string | null; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
export interface MaterialLine { name: string; qty: number; amount: number; raw?: string }
/** taxMode: 入れた金額が「税抜(ex)」か「税込(in)」か。保存する金額は、いつも税抜（税込は税率10%で割り戻す） */
export interface MaterialInput { orderedOn: string; supplier: string; item: string; kind: MaterialKind; amount: number; note?: string; lines?: MaterialLine[]; taxMode?: "ex" | "in" }
export const MATERIAL_TAX_RATE = 0.1;
export const toExTax = (v: number, mode: "ex" | "in" | undefined) => (mode === "in" ? Math.round(v / (1 + MATERIAL_TAX_RATE)) : v);
function materialValues(i: MaterialInput) {
  const mode = i.taxMode === "in" ? "in" : "ex";
  const lines = i.lines === undefined ? null : JSON.stringify(i.lines.map((l) => ({ name: l.name.trim(), qty: l.qty, amount: toExTax(l.amount, mode), ...(l.raw && l.raw.trim() && l.raw.trim() !== l.name.trim() ? { raw: l.raw.trim().slice(0, 120) } : {}) })));
  return { mode, amountEx: toExTax(i.amount, mode), entered: mode === "in" ? i.amount : null, lines };
}

function checkMaterial(i: MaterialInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.orderedOn ?? "")) throw new Error("発注した日が正しくありません");
  if (!["supply", "retail", "other"].includes(i.kind)) throw new Error("種類が正しくありません");
  if (!Number.isInteger(i.amount) || i.amount < 0 || i.amount > 100000000) throw new Error("金額は、0円以上の整数で入れてください");
  if (!i.supplier?.trim()) throw new Error("発注先（業者）を入れてください");
  if (i.lines !== undefined) {
    if (!Array.isArray(i.lines) || i.lines.length > 200) throw new Error("明細が多すぎます（200行まで）");
    for (const l of i.lines) if (typeof l.name !== "string" || !l.name.trim() || l.name.length > 120 || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 100000 || !Number.isInteger(l.amount) || l.amount < 0 || l.amount > 100000000) throw new Error("明細の商品名・数量・金額を確認してください");
  }
  if ((i.supplier ?? "").length > 80 || (i.item ?? "").length > 200 || (i.note ?? "").length > 500) throw new Error("文字が長すぎます");
}

/** 期間（from〜to）の発注を、新しい順に。取り消したものは、店長以上だけに「取り消し」として見える */
export async function listMaterialOrders(db: Database, userId: string, storeId: string, from: string, to: string): Promise<MaterialOrder[]> {
  return (await asUser(db, userId, (q) => q.query<MaterialOrder>(
    `select o.id, o.store_id as "storeId", o.ordered_on::text as "orderedOn", o.supplier, o.item, o.kind, o.amount, o.note, o.lines, o.tax_mode as "taxMode", o.entered_amount as entered,
            m.name as by, o.created_at as at, (o.deleted_at is not null) as deleted, (o.updated_at is not null) as edited
       from material_orders o left join memberships m on m.id = o.created_by
      where o.store_id = $1 and o.ordered_on between $2 and $3
      order by o.ordered_on desc, o.created_at desc`, [storeId, from, to]))).rows;
}

export async function addMaterialOrder(db: Database, userId: string, storeId: string, i: MaterialInput): Promise<string> {
  checkMaterial(i);
  const v = materialValues(i);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => (await q.query<{ id: string }>(
      `insert into material_orders (company_id, store_id, ordered_on, supplier, item, kind, amount, note, lines, created_by, tax_mode, entered_amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::jsonb,'[]'::jsonb),$10,$11,$12) returning id`,
      [me.companyId, storeId, i.orderedOn, i.supplier.trim(), (i.item ?? "").trim(), i.kind, v.amountEx, (i.note ?? "").trim(), v.lines, userId, v.mode, v.entered])).rows[0].id);
  } catch { throw new ForbiddenError(); }
}

export async function updateMaterialOrder(db: Database, userId: string, id: string, i: MaterialInput): Promise<void> {
  checkMaterial(i);
  const v = materialValues(i);
  let n = 0;
  try {
    n = await asUser(db, userId, async (q) => (await q.query(
      `update material_orders set ordered_on=$2, supplier=$3, item=$4, kind=$5, amount=$6, note=$7, lines=coalesce($9::jsonb, lines), tax_mode=$10, entered_amount=$11, updated_at=now(), updated_by=$8
        where id = $1 and deleted_at is null returning id`,
      [id, i.orderedOn, i.supplier.trim(), (i.item ?? "").trim(), i.kind, v.amountEx, (i.note ?? "").trim(), userId, v.lines, v.mode, v.entered])).rows.length);
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** 消さずに「取り消し」にする（記録は残る） */
export async function cancelMaterialOrder(db: Database, userId: string, id: string): Promise<void> {
  let ok = false;
  try { ok = await asUser(db, userId, async (q) => (await q.query<{ ok: boolean }>("select public.material_cancel($1) as ok", [id])).rows[0].ok); } catch { throw new ForbiddenError(); }
  if (!ok) throw new ForbiddenError();
}

export async function listMaterialSuppliers(db: Database, userId: string, storeId: string): Promise<string[]> {
  return (await asUser(db, userId, (q) => q.query<{ supplier: string }>(
    `select supplier from material_orders where store_id = $1 and supplier <> '' group by supplier order by count(*) desc, max(created_at) desc limit 50`, [storeId]))).rows.map((r) => r.supplier);
}

export async function getMaterialBudget(db: Database, userId: string, storeId: string, month: string): Promise<number | null> {
  const r = (await asUser(db, userId, (q) => q.query<{ amount: number }>("select amount from material_budgets where store_id = $1 and month = $2", [storeId, month]))).rows[0];
  return r ? r.amount : null;
}

/** 月の予算（税抜）を決める。null で消す（店長=自店・管理者=全店） */
export async function setMaterialBudget(db: Database, userId: string, storeId: string, month: string, amount: number | null): Promise<void> {
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new Error("月が正しくありません");
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 1000000000)) throw new Error("予算は、0円以上の整数で入れてください");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      if (amount === null) { await q.query("delete from material_budgets where store_id=$1 and month=$2", [storeId, month]); return; }
      await q.query(
        `insert into material_budgets (store_id, company_id, month, amount, updated_by) values ($1,$2,$3,$4,$5)
         on conflict (store_id, month) do update set amount = excluded.amount, updated_at = now(), updated_by = excluded.updated_by`, [storeId, me.companyId, month, amount, userId]);
    });
  } catch { throw new ForbiddenError(); }
}

/** 変更・取り消しの記録（店長以上） */
export async function listMaterialLog(db: Database, userId: string, storeId: string, limit = 100): Promise<MaterialLogRow[]> {
  return (await asUser(db, userId, (q) => q.query<MaterialLogRow>(
    `select l.id, l.order_id as "orderId", l.action, m.name as by, l.at, l.before, l.after
       from material_order_log l left join memberships m on m.id = l.user_id
      where l.store_id = $1 order by l.id desc limit $2`, [storeId, limit]))).rows;
}

export interface MaterialImage { id: string; orderId: string; by: string | null; at: string; size: number }
const MAX_MATERIAL_IMAGE = 3 * 1024 * 1024, MAX_IMAGES_PER_ORDER = 8;

/** 発注画面のスクリーンショットを付ける。貼った人・日時は自動で記録される */
export async function addMaterialImage(db: Database, userId: string, orderId: string, mime: string, data: Buffer): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("画像（JPEG・PNG・WebP）を選んでください");
  if (data.length === 0 || data.length > MAX_MATERIAL_IMAGE) throw new Error("画像が大きすぎます（3MBまで）");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => {
      const o = (await q.query<{ store_id: string }>("select store_id from material_orders where id = $1 and deleted_at is null", [orderId])).rows[0];
      if (!o) throw new Error("x");
      const n = Number((await q.query<{ n: number }>("select count(*)::int as n from material_order_images where order_id = $1", [orderId])).rows[0].n);
      if (n >= MAX_IMAGES_PER_ORDER) throw new Error("limit");
      return (await q.query<{ id: string }>(
        `insert into material_order_images (order_id, company_id, store_id, mime, size, data, created_by) values ($1,$2,$3,$4,$5,decode($6::text,'hex'),$7) returning id`,
        [orderId, me.companyId, o.store_id, mime, data.length, data.toString("hex"), userId])).rows[0].id;
    });
  } catch (e) { if ((e as Error).message === "limit") throw new Error(`1件に付けられる画像は${MAX_IMAGES_PER_ORDER}枚までです`); throw new ForbiddenError(); }
}

export async function listMaterialImages(db: Database, userId: string, storeId: string, from: string, to: string): Promise<MaterialImage[]> {
  return (await asUser(db, userId, (q) => q.query<MaterialImage>(
    `select i.id, i.order_id as "orderId", m.name as by, i.created_at as at, i.size
       from material_order_images i join material_orders o on o.id = i.order_id left join memberships m on m.id = i.created_by
      where i.store_id = $1 and o.ordered_on between $2 and $3 order by i.created_at`, [storeId, from, to]))).rows;
}

export async function getMaterialImage(db: Database, userId: string, id: string): Promise<{ mime: string; data: Buffer } | null> {
  const r = (await asUser(db, userId, (q) => q.query<{ mime: string; data: Uint8Array }>("select mime, data from material_order_images where id = $1", [id]))).rows[0];
  return r ? { mime: r.mime, data: Buffer.from(r.data) } : null;
}

export interface MaterialMemory {
  suppliers: string[];
  /** よく使う商品（ボタンにする）。発注先ごとに、回数の多い順。単価=最後に入れた金額÷数量 */
  frequent?: { name: string; supplier: string; unit: number; count: number }[];
  /** 今まで入れた商品名（よく使う順） */
  items: string[];
  /** 読み取った文字 → 直した商品名（学習） */
  aliases: { raw: string; name: string }[];
  /** 発注先ごとの、最後に使った税の入れ方 */
  supplierTax: Record<string, "ex" | "in">;
}

/** 今までの記録から、業者・商品名・読み取りの直し方・税の入れ方を覚えておく（新しく覚えさせる作業は不要） */
export async function getMaterialMemory(db: Database, userId: string, storeId: string): Promise<MaterialMemory> {
  return asUser(db, userId, async (q) => {
    const suppliers = (await q.query<{ supplier: string }>(
      `select supplier from material_orders where store_id = $1 and deleted_at is null and supplier <> '' group by supplier order by count(*) desc, max(created_at) desc limit 100`, [storeId])).rows.map((r) => r.supplier);
    const lines = (await q.query<{ name: string; raw: string | null; n: number }>(
      `select l->>'name' as name, l->>'raw' as raw, count(*)::int as n
         from material_orders o, jsonb_array_elements(o.lines) l
        where o.store_id = $1 and o.deleted_at is null and coalesce(l->>'name','') <> ''
        group by 1, 2 order by n desc limit 1500`, [storeId])).rows;
    const freq = (await q.query<{ name: string; supplier: string; unit: number; count: number }>(
      `select name, supplier, (array_agg(unit order by at desc))[1]::int as unit, count(*)::int as count from (
         select l->>'name' as name, o.supplier, o.created_at as at,
                round(coalesce((l->>'amount')::numeric, 0) / greatest(coalesce((l->>'qty')::numeric, 1), 1)) as unit
           from material_orders o, jsonb_array_elements(o.lines) l
          where o.store_id = $1 and o.deleted_at is null and coalesce(l->>'name','') <> '') t
        group by name, supplier order by count desc, name limit 60`, [storeId])).rows;
    const items = [...new Set(lines.map((l) => l.name))].slice(0, 500);
    const aliases = lines.filter((l) => l.raw && l.raw !== l.name).map((l) => ({ raw: l.raw as string, name: l.name }));
    const st = (await q.query<{ supplier: string; tax_mode: "ex" | "in" }>(
      `select distinct on (supplier) supplier, tax_mode from material_orders where store_id = $1 and deleted_at is null and supplier <> '' order by supplier, created_at desc`, [storeId])).rows;
    return { suppliers, frequent: freq, items, aliases, supplierTax: Object.fromEntries(st.map((r) => [r.supplier, r.tax_mode])) };
  });
}


/** 材料担当にする／外す（管理者のみ）。材料担当は、全店の材料費を見られて、書き込めて、統括の画面も見られる */
export async function setMaterialManager(db: Database, userId: string, targetId: string, on: boolean): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  const ok = await asUser(db, userId, (q) => q.query("select 1 from memberships where id = $1 and status = 'active'", [targetId]));
  if (ok.rows.length === 0) throw new ForbiddenError();
  await db.query("update memberships set material_manager = $2 where id = $1", [targetId, on]);
}

export interface SummaryOrder { id: string; storeId: string; orderedOn: string; supplier: string; item: string; kind: MaterialKind; amount: number }
export interface SummaryLine { orderId: string; name: string; qty: number; amount: number }

/** 統括: 期間の発注（取り消しは除く）と明細。管理者・材料担当だけ（見える範囲はDBの権限で決まる） */
export async function materialSummaryData(db: Database, userId: string, from: string, to: string): Promise<{ orders: SummaryOrder[]; lines: SummaryLine[] }> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const ok = me.level >= 4 || (await asUser(db, userId, (q) => q.query<{ m: boolean }>("select app.is_material_mgr() as m"))).rows[0]?.m;
  if (!ok) throw new ForbiddenError();
  return asUser(db, userId, async (q) => {
    const orders = (await q.query<SummaryOrder>(
      `select id, store_id as "storeId", ordered_on::text as "orderedOn", supplier, item, kind, amount
         from material_orders where deleted_at is null and ordered_on between $1 and $2 order by ordered_on, created_at`, [from, to])).rows;
    const lines = (await q.query<SummaryLine>(
      `select o.id as "orderId", l->>'name' as name, (l->>'qty')::int as qty, (l->>'amount')::int as amount
         from material_orders o, jsonb_array_elements(o.lines) l
        where o.deleted_at is null and o.ordered_on between $1 and $2`, [from, to])).rows;
    return { orders, lines };
  });
}


let lastImagePurge = 0;
/**
 * 発注画面のスクリーンショットは、「今月」と「先月」の2か月分だけ残し、それより前のものは自動で消す
 * （金額・明細などの数字は残る）。例: 11月になると、9月以前の画像が消える。
 * API呼び出しのついでに1時間に1回だけ確認する。
 */
export async function purgeOldMaterialImages(db: Database, force = false, today?: string): Promise<number> {
  if (!force && Date.now() - lastImagePurge < 3_600_000) return 0;
  lastImagePurge = Date.now();
  const { rows } = await db.query<{ n: number }>(
    `with cutoff as (
       select (date_trunc('month', coalesce($1::date, (now() at time zone 'Asia/Tokyo')::date)) - interval '1 month')::date as d
     ), gone as (
       delete from material_order_images i using material_orders o, cutoff c
        where o.id = i.order_id and o.ordered_on < c.d returning i.id
     ) select count(*)::int as n from gone`, [today ?? null]);
  // 売上のレジ画面の写真も、同じ（今月と先月だけ残す）
  await db.query(
    `delete from sales_images where month < (date_trunc('month', coalesce($1::date, (now() at time zone 'Asia/Tokyo')::date)) - interval '1 month')::date`, [today ?? null]);
  return rows[0]?.n ?? 0;
}


// ------------------------------------------------------------------ スマホへの通知（Web Push）
export async function getPushKey(db: Database): Promise<string> { return (await vapidKeys(db)).pub; }

/** この端末を、通知の送り先として登録する（自分の分だけ） */
export async function subscribePush(db: Database, userId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent = ""): Promise<void> {
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !sub.p256dh || !sub.auth) throw new Error("通知の登録に失敗しました");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  await asUser(db, userId, async (q) => {
    await q.query("delete from push_subscriptions where endpoint = $1", [sub.endpoint]);
    await q.query("insert into push_subscriptions (company_id, membership_id, endpoint, p256dh, auth, user_agent) values ($1,$2,$3,$4,$5,$6)",
      [me.companyId, userId, sub.endpoint, sub.p256dh, sub.auth, userAgent.slice(0, 200)]);
  });
}
export async function unsubscribePush(db: Database, userId: string, endpoint: string): Promise<void> {
  await asUser(db, userId, (q) => q.query("delete from push_subscriptions where endpoint = $1", [endpoint]));
}
export async function countMyPushDevices(db: Database, userId: string): Promise<number> {
  return Number((await asUser(db, userId, (q) => q.query<{ n: number }>("select count(*)::int as n from push_subscriptions"))).rows[0].n);
}
export async function sendTestPush(db: Database, userId: string): Promise<number> {
  return pushToUsers(db, [userId], { title: "通知のテストです", body: "このメッセージが見えたら、通知は届いています。", url: "/home", tag: "test" });
}

export interface NoticeSetting { storeId: string; name: string; enabled: boolean; time: string; editable: boolean }
export async function getNoticeSettings(db: Database, userId: string): Promise<NoticeSetting[]> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const rows = (await asUser(db, userId, (q) => q.query<{ id: string; name: string; enabled: boolean; time: string }>(
    `select id, name, notice_enabled as enabled, to_char(notice_time, 'HH24:MI') as time from stores where status = 'active' order by sort_order, name`))).rows;
  return rows.filter((r) => me.level >= 3 || r.id === me.storeId).map((r) => ({ storeId: r.id, name: r.name, enabled: r.enabled, time: r.time, editable: me.level === 4 || (me.level === 3 && r.id === me.storeId) }));
}
/** 朝の通知の「使う／使わない」と時刻（5分刻み）を変える（店長=自店・管理者=全店） */
export async function setNoticeSetting(db: Database, userId: string, storeId: string, enabled: boolean, time: string): Promise<void> {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || Number(time.slice(3)) % 5 !== 0) throw new Error("時刻は、5分きざみで入れてください（例 08:30）");
  let ok = false;
  try { ok = await asUser(db, userId, async (q) => (await q.query<{ ok: boolean }>("select public.set_store_notice($1, $2, $3::time) as ok", [storeId, !!enabled, time])).rows[0].ok); } catch { throw new ForbiddenError(); }
  if (!ok) throw new ForbiddenError();
}

const jstNow = () => new Date(Date.now() + 9 * 3600_000).toISOString();
let lastNoticeRun = 0;
/**
 * 毎朝の「今日の出勤メンバー・休みメンバー」を、各店のスタッフに送る。
 * お店ごとに決めた時刻（初期8:30）になったら、その日に1回だけ。公開されたシフトがある日だけ送る。
 * 外から5分ごとに呼ばれる（GitHub Actions）＋ API 呼び出しのついで。何回呼んでも二重には送らない。
 */
export async function runMorningNotices(db: Database, force = false, at?: string): Promise<{ stores: number; sent: number }> {
  if (!force && Date.now() - lastNoticeRun < 60_000) return { stores: 0, sent: 0 };
  lastNoticeRun = Date.now();
  const now = at ?? jstNow(), today = now.slice(0, 10), hhmm = now.slice(11, 16);
  const stores = (await db.query<{ id: string; name: string }>(
    `select id, name from stores where status = 'active' and notice_enabled and (notice_last_sent is null or notice_last_sent < $1::date)
        and notice_time <= $2::time and notice_time > ($2::time - interval '3 hours')`, [today, hhmm])).rows;
  let stCount = 0, sent = 0;
  for (const st of stores) {
    const claim = await db.query("update stores set notice_last_sent = $2::date where id = $1 and (notice_last_sent is null or notice_last_sent < $2::date) returning id", [st.id, today]);
    if (claim.rows.length === 0) continue;
    const rows = (await db.query<{ id: string; name: string; short_name: string | null; kind: string }>(
      `select m.id, m.name, m.short_name, s.kind from shifts s join memberships m on m.id = s.membership_id
        where s.store_id = $1 and s.day = $2::date and m.status = 'active' and app.is_published(s.period_id, s.store_id)`, [st.id, today])).rows;
    if (rows.length === 0) continue;
    const short = shortNames(rows.map((r) => ({ id: r.id, name: r.name, shortName: r.short_name })));
    const work = rows.filter((r) => r.kind === "work").map((r) => short.get(r.id) ?? r.name);
    const off = rows.filter((r) => r.kind !== "work" && r.kind !== "other").map((r) => short.get(r.id) ?? r.name);
    const body = `出勤（${work.length}人）：${work.join("・") || "なし"}\n休み（${off.length}人）：${off.join("・") || "なし"}`;
    const people = (await db.query<{ id: string }>("select id from memberships where store_id = $1 and status = 'active' and not display_only", [st.id])).rows.map((r) => r.id);
    sent += await pushToUsers(db, people, { title: `${st.name} 今日の出勤（${jpDay(today)}）`, body, url: "/shifts", tag: `morning-${st.id}` });
    stCount++;
  }
  return { stores: stCount, sent };
}

/** シフトが公開されたとき、そのお店の全員に通知（アプリの中のお知らせにも入れる） */
export async function notifyShiftPublished(db: Database, periodId: string, storeId: string): Promise<number> {
  const per = (await db.query<{ s: string; e: string; company_id: string }>("select start_date::text as s, end_date::text as e, company_id from shift_periods where id = $1", [periodId])).rows[0];
  const st = (await db.query<{ name: string }>("select name from stores where id = $1", [storeId])).rows[0];
  if (!per || !st) return 0;
  const people = (await db.query<{ id: string }>("select id from memberships where store_id = $1 and status = 'active' and not display_only", [storeId])).rows.map((r) => r.id);
  const title = `${st.name} のシフトが公開されました`;
  const body = `${md(per.s)}〜${md(per.e)} のシフトを見られます。押して確認してください。`;
  for (const uid of people) {
    await db.query("delete from notifications where user_id = $1 and kind = 'shift' and link = '/shifts' and read_at is null", [uid]);
    await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'shift',$3,$4,'/shifts')", [per.company_id, uid, title, body]);
  }
  return pushToUsers(db, people, { title, body, url: "/shifts", tag: `published-${storeId}` });
}


// ------------------------------------------------------------------ レッスン記録（教育担当が毎日「だれが何をしたか」を記録）
export interface LessonCategory { id: string; name: string; sortOrder: number; active: boolean; parentId: string | null }
export interface LessonAssistant { id: string; name: string; shortName: string | null; rank: "assistant" | "stylist" | null }
export interface LessonRow {
  id: string; storeId: string; assistantId: string; assistantName: string; categoryId: string; category: string; leaf: string;
  day: string; minutes: number | null; note: string; ordinal: number; byName: string | null; createdAt: string;
}
const DEFAULT_LESSONS: [string, string[]][] = [
  ["カットモデル", []], ["ウィッグカット", ["ワンレングス", "グラデーション", "レイヤー"]], ["カラー", ["ファッションカラー", "グレイカラー（リタッチ）"]],
  ["パーマ", []], ["髪質改善", []], ["シャンプー", []],
];

/** ボタン（カテゴリ）。まだ無いお店には、初期のボタンを自動で作る */
export async function listLessonCategories(db: Database, userId: string, storeId: string, includeHidden = false): Promise<LessonCategory[]> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const have = (await db.query<{ n: number }>("select count(*)::int as n from lesson_categories where store_id = $1", [storeId])).rows[0].n;
  if (have === 0) {
    const co = (await db.query<{ company_id: string }>("select company_id from stores where id = $1", [storeId])).rows[0];
    if (co && co.company_id === me.companyId) for (const [i, [n, kids]] of DEFAULT_LESSONS.entries()) {
      const pid = (await db.query<{ id: string }>("insert into lesson_categories (company_id, store_id, name, sort_order) values ($1,$2,$3,$4) returning id", [co.company_id, storeId, n, i + 1])).rows[0].id;
      for (const [j, k] of kids.entries()) await db.query("insert into lesson_categories (company_id, store_id, name, sort_order, parent_id) values ($1,$2,$3,$4,$5)", [co.company_id, storeId, k, j + 1, pid]);
    }
  }
  return (await asUser(db, userId, (q) => q.query<LessonCategory>(
    `select id, name, sort_order as "sortOrder", active, parent_id as "parentId" from lesson_categories where store_id = $1 ${includeHidden ? "" : "and active"} order by sort_order, name`, [storeId]))).rows;
}

export async function saveLessonCategory(db: Database, userId: string, storeId: string, c: { id?: string; name?: string; active?: boolean; move?: "up" | "down"; parentId?: string }): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  const name = c.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 30)) throw new Error("ボタンの名前は、1〜30文字で入れてください");
  try {
    await asUser(db, userId, async (q) => {
      if (!c.id) {
        if (!name) throw new Error("ボタンの名前を入れてください");
        if (c.parentId) {
          const par = (await q.query<{ parent_id: string | null }>("select parent_id from lesson_categories where id = $1 and store_id = $2", [c.parentId, storeId])).rows[0];
          if (!par) throw new ForbiddenError();
          if (par.parent_id) throw new Error("ボタンの中のボタンは、1段までです");
        }
        const max = Number((await q.query<{ m: number }>("select coalesce(max(sort_order),0)::int as m from lesson_categories where store_id = $1 and parent_id is not distinct from $2::uuid", [storeId, c.parentId ?? null])).rows[0].m);
        await q.query("insert into lesson_categories (company_id, store_id, name, sort_order, parent_id) values ($1,$2,$3,$4,$5)", [me.companyId, storeId, name, max + 1, c.parentId ?? null]);
        return;
      }
      if (c.move) {
        const me0 = (await q.query<{ parent_id: string | null }>("select parent_id from lesson_categories where id = $1 and store_id = $2", [c.id, storeId])).rows[0];
        if (!me0) throw new ForbiddenError();
        const list = (await q.query<{ id: string }>("select id from lesson_categories where store_id = $1 and parent_id is not distinct from $2::uuid order by sort_order, name", [storeId, me0.parent_id])).rows.map((r) => r.id);
        const i = list.indexOf(c.id), j = c.move === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        for (const [k, id] of list.entries()) { const r = await q.query("update lesson_categories set sort_order = $2 where id = $1 and store_id = $3 returning id", [id, k + 1, storeId]); if (r.rows.length === 0) throw new ForbiddenError(); }
        return;
      }
      const r = await q.query("update lesson_categories set name = coalesce($3, name), active = coalesce($4, active) where id = $1 and store_id = $2 returning id", [c.id, storeId, name ?? null, c.active ?? null]);
      if (r.rows.length === 0) throw new ForbiddenError();
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("ボタン")) throw e;
    if (/unique|duplicate/i.test((e as Error).message ?? "")) throw new Error("同じ名前のボタンがあります");
    throw new ForbiddenError();
  }
}

/** 記録の対象になる人（そのお店の在籍スタッフ。アシスタントを先に） */
export async function listLessonAssistants(db: Database, userId: string, storeId: string): Promise<LessonAssistant[]> {
  const rows = (await asUser(db, userId, (q) => q.query<LessonAssistant>(
    `select id, name, short_name as "shortName", rank from memberships where store_id = $1 and status = 'active' and not display_only and level < 4
      order by (rank = 'assistant') desc nulls last, employee_code`, [storeId]))).rows;
  return rows;
}

export interface LessonInput { assistantId: string; categoryId: string; day: string; minutes?: number | null; note?: string }
function checkLesson(i: { day?: string; minutes?: number | null; note?: string }) {
  if (i.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(i.day)) throw new Error("日付が正しくありません");
  if (i.minutes !== undefined && i.minutes !== null && (!Number.isInteger(i.minutes) || i.minutes < 1 || i.minutes > 600)) throw new Error("時間は、1〜600分で入れてください");
  if ((i.note ?? "").length > 300) throw new Error("メモが長すぎます");
}

export async function addLesson(db: Database, userId: string, storeId: string, i: LessonInput): Promise<{ id: string; ordinal: number }> {
  checkLesson(i);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return await asUser(db, userId, async (q) => {
      const id = (await q.query<{ id: string }>(
        `insert into lesson_logs (company_id, store_id, assistant_id, category_id, day, minutes, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [me.companyId, storeId, i.assistantId, i.categoryId, i.day, i.minutes ?? null, (i.note ?? "").trim(), userId])).rows[0].id;
      const ordinal = Number((await q.query<{ n: number }>(
        `select count(*)::int as n from lesson_logs where assistant_id = $1 and category_id = $2 and deleted_at is null
            and (day, created_at) <= (select day, created_at from lesson_logs where id = $3)`, [i.assistantId, i.categoryId, id])).rows[0].n);
      return { id, ordinal };
    });
  } catch { throw new ForbiddenError("この記録を入れる権限がないか、対象の人・ボタンが正しくありません"); }
}

export async function updateLesson(db: Database, userId: string, id: string, i: { categoryId?: string; day?: string; minutes?: number | null; note?: string }): Promise<void> {
  checkLesson(i);
  let n = 0;
  try {
    n = (await asUser(db, userId, (q) => q.query(
      `update lesson_logs set category_id = coalesce($2, category_id), day = coalesce($3::date, day), minutes = case when $4::boolean then $5::int else minutes end,
              note = coalesce($6, note) where id = $1 and deleted_at is null returning id`,
      [id, i.categoryId ?? null, i.day ?? null, i.minutes !== undefined, i.minutes ?? null, i.note === undefined ? null : i.note.trim()]))).rows.length;
  } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** 消さずに「取り消し」にする（まちがえて押したとき） */
export async function deleteLesson(db: Database, userId: string, id: string): Promise<void> {
  let n = 0;
  try { n = (await asUser(db, userId, (q) => q.query("update lesson_logs set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null returning id", [id, userId]))).rows.length; } catch { throw new ForbiddenError(); }
  if (n === 0) throw new ForbiddenError();
}

/** 期間の記録。ordinal = その人のそのカテゴリの「何人目（何回目）」（これまでの全部を数える） */
export async function listLessons(db: Database, userId: string, q0: { storeId?: string; from: string; to: string; assistantId?: string }): Promise<LessonRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q0.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q0.to)) throw new Error("期間が正しくありません");
  return (await asUser(db, userId, (q) => q.query<LessonRow>(
    `select t.* from (
       select l.id, l.store_id as "storeId", l.assistant_id as "assistantId", a.name as "assistantName", l.category_id as "categoryId", case when pc.name is null then c.name else pc.name || '・' || c.name end as category, c.name as leaf,
              l.day::text as day, l.minutes, l.note,
              row_number() over (partition by l.assistant_id, l.category_id order by l.day, l.created_at) as ordinal,
              u.name as "byName", l.created_at as "createdAt"
         from lesson_logs l join memberships a on a.id = l.assistant_id join lesson_categories c on c.id = l.category_id left join lesson_categories pc on pc.id = c.parent_id left join memberships u on u.id = l.created_by
        where l.deleted_at is null and ($1::uuid is null or l.store_id = $1) and ($2::uuid is null or l.assistant_id = $2)
     ) t where t.day between $3 and $4 order by t.day desc, t."createdAt" desc`,
    [q0.storeId ?? null, q0.assistantId ?? null, q0.from, q0.to]))).rows.map((r) => ({ ...r, ordinal: Number(r.ordinal) }));
}

/** 教育担当にする／外す（店長=自店・管理者=全店） */
export async function setEduLead(db: Database, userId: string, targetId: string, on: boolean): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 3) throw new ForbiddenError();
  const t = (await asUser(db, userId, (q) => q.query<{ store_id: string; level: number }>("select store_id, level from memberships where id = $1 and status = 'active'", [targetId]))).rows[0];
  if (!t || (me.level === 3 && t.store_id !== me.storeId)) throw new ForbiddenError();
  await db.query("update memberships set edu_lead = $2 where id = $1", [targetId, on]);
}

/** これまでの合計（その人×カテゴリ）。記録の画面で「次は何人目」を出すのに使う */
export async function lessonCounts(db: Database, userId: string, storeId: string): Promise<Record<string, number>> {
  const rows = (await asUser(db, userId, (q) => q.query<{ a: string; c: string; n: number }>(
    "select assistant_id as a, category_id as c, count(*)::int as n from lesson_logs where store_id = $1 and deleted_at is null group by 1, 2", [storeId]))).rows;
  return Object.fromEntries(rows.map((r) => [`${r.a}|${r.c}`, Number(r.n)]));
}


// ------------------------------------------------------------------ 有給の年2回の提出と、変更の申請
export interface LeaveWindow { id: string; label: string; rangeStart: string; rangeEnd: string; status: "open" | "closed" }
export type LeaveStatus = "pending_manager" | "pending_office" | "approved" | "rejected" | "cancelled";
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending_manager: "店長の確認待ち", pending_office: "事務員さんの許可待ち", approved: "許可されました", rejected: "却下されました", cancelled: "取り消しました",
};
export interface LeaveChange {
  id: string; windowId: string; label: string; storeId: string; storeName: string; membershipId: string; name: string; fromDay: string | null; toDay: string | null;
  reason: string; status: LeaveStatus; managerName: string | null; managerComment: string | null; officeName: string | null; officeComment: string | null; createdAt: string;
}
const CHANGE_SQL = `select c.id, c.window_id as "windowId", w.label, c.store_id as "storeId", s.name as "storeName", c.membership_id as "membershipId", m.name,
       c.from_day::text as "fromDay", c.to_day::text as "toDay", c.reason, c.status, mm.name as "managerName", c.manager_comment as "managerComment",
       om.name as "officeName", c.office_comment as "officeComment", c.created_at as "createdAt"
  from leave_changes c join leave_windows w on w.id = c.window_id join stores s on s.id = c.store_id join memberships m on m.id = c.membership_id
       left join memberships mm on mm.id = c.manager_id left join memberships om on om.id = c.office_id`;

function mapLeaveError(e: unknown): never {
  const m = (e as Error).message ?? "";
  const map: [RegExp, string][] = [
    [/window open/, "受付中のあいだは、画面の「有給の日」を直接直せます（申請は、締切のあとに使います）"],
    [/no such plan/, "その日は、あなたの有給の日にありません"], [/out of range/, "その日は、有給を取れる範囲の外です"],
    [/already planned/, "その日は、すでに有給の日です"], [/duplicate/, "同じ内容の申請が、すでに出ています"], [/already decided/, "この申請は、すでに結果が出ています"],
    [/own request/, "自分の申請は、自分では許可できません"], [/empty/, "変更の内容を入れてください"],
  ];
  for (const [re, t] of map) if (re.test(m)) throw new Error(t);
  throw new ForbiddenError();
}

export async function listLeaveWindows(db: Database, userId: string): Promise<LeaveWindow[]> {
  return (await asUser(db, userId, (q) => q.query<LeaveWindow>(
    `select id, label, range_start::text as "rangeStart", range_end::text as "rangeEnd", status from leave_windows order by created_at desc limit 12`))).rows;
}
/** 提出の受付を開く（事務員さん＝管理者） */
export async function openLeaveWindow(db: Database, userId: string, w: { label: string; start: string; end: string }): Promise<string> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  if (!w.label.trim() || w.label.length > 40) throw new Error("名前（例: 2026年 下期）を入れてください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.start) || !/^\d{4}-\d{2}-\d{2}$/.test(w.end) || w.end < w.start) throw new Error("有給を取れる日の範囲が正しくありません");
  let id = "";
  try { id = (await asUser(db, userId, (q) => q.query<{ id: string }>("insert into leave_windows (company_id, label, range_start, range_end, created_by) values ($1,$2,$3,$4,$5) returning id", [me.companyId, w.label.trim(), w.start, w.end, userId]))).rows[0].id; }
  catch { throw new Error("範囲は、400日以内にしてください"); }
  const staff = (await db.query<{ id: string }>("select id from memberships where company_id = $1 and status = 'active' and not display_only", [me.companyId])).rows.map((r) => r.id);
  await leaveNotify(db, me.companyId, staff, `有給の提出を受け付けています（${w.label.trim()}）`, `${md(w.start)}〜${md(w.end)} の間で、有給を取りたい日を選んで「提出する」を押してください。`, "/leave");
  return id;
}
export async function setLeaveWindowStatus(db: Database, userId: string, id: string, status: "open" | "closed"): Promise<void> {
  const r = await asUser(db, userId, (q) => q.query("update leave_windows set status = $2 where id = $1 returning id", [id, status])).catch(() => ({ rows: [] }));
  if (r.rows.length === 0) throw new ForbiddenError();
}

async function leaveNotify(db: Database, companyId: string, userIds: string[], title: string, body: string, link: string): Promise<void> {
  const ids = [...new Set(userIds)];
  for (const uid of ids) await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'leave',$3,$4,$5)", [companyId, uid, title, body, link]);
  await pushToUsers(db, ids, { title, body, url: link, tag: `leave-${link}` }).catch(() => 0);
}
async function managersOf(db: Database, storeId: string, companyId: string): Promise<string[]> {
  const m = (await db.query<{ id: string }>("select id from memberships where store_id = $1 and level = 3 and status = 'active'", [storeId])).rows.map((r) => r.id);
  return m.length ? m : await officeIds(db, companyId);
}
const officeIds = async (db: Database, companyId: string) => (await db.query<{ id: string }>("select id from memberships where company_id = $1 and level = 4 and status = 'active'", [companyId])).rows.map((r) => r.id);

export async function getMyLeavePlan(db: Database, userId: string, windowId: string): Promise<{ days: string[]; submitted: boolean; changes: LeaveChange[] }> {
  return asUser(db, userId, async (q) => {
    const days = (await q.query<{ day: string }>("select day::text as day from leave_plans where window_id = $1 and membership_id = $2 order by day", [windowId, userId])).rows.map((r) => r.day);
    const submitted = (await q.query("select 1 from leave_submissions where window_id = $1 and membership_id = $2", [windowId, userId])).rows.length > 0;
    const changes = (await q.query<LeaveChange>(`${CHANGE_SQL} where c.window_id = $1 and c.membership_id = $2 order by c.created_at desc`, [windowId, userId])).rows;
    return { days, submitted, changes };
  });
}

/** 受付中のあいだ、自分の有給の日を、まとめて入れ直す */
export async function setMyLeaveDays(db: Database, userId: string, windowId: string, days: string[]): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  if (days.length > 60 || days.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("日付が正しくありません");
  const want = [...new Set(days)];
  try {
    await asUser(db, userId, async (q) => {
      const w = (await q.query<{ status: string; range_start: string; range_end: string }>("select status, range_start::text, range_end::text from leave_windows where id = $1", [windowId])).rows[0];
      if (!w || w.status !== "open") throw new Error("closed");
      if (want.some((d) => d < w.range_start || d > w.range_end)) throw new Error("range");
      await q.query("delete from leave_plans where window_id = $1 and membership_id = $2 and not (day = any($3::date[]))", [windowId, userId, want]);
      for (const d of want) await q.query("insert into leave_plans (company_id, window_id, store_id, membership_id, day) values ($1,$2,$3,$4,$5) on conflict do nothing", [me.companyId, windowId, me.storeId, userId, d]);
      await q.query("delete from leave_submissions where window_id = $1 and membership_id = $2", [windowId, userId]);      // 直したら、もう一度「提出する」
    });
  } catch (e) {
    if ((e as Error).message === "closed") throw new Error("受付中ではありません（日を直すときは、変更を申請してください）");
    throw new Error("有給を取れる範囲の外の日があります");
  }
}
export async function submitMyLeave(db: Database, userId: string, windowId: string, on: boolean): Promise<void> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      await q.query("delete from leave_submissions where window_id = $1 and membership_id = $2", [windowId, userId]);
      if (on) await q.query("insert into leave_submissions (window_id, membership_id, company_id, store_id) values ($1,$2,$3,$4)", [windowId, userId, me.companyId, me.storeId]);
    });
  } catch { throw new ForbiddenError("受付中ではありません"); }
}

export async function requestLeaveChange(db: Database, userId: string, windowId: string, fromDay: string | null, toDay: string | null, reason: string): Promise<string> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  let id = "";
  try { id = (await asUser(db, userId, (q) => q.query<{ id: string }>("select public.leave_request($1, $2::date, $3::date, $4) as id", [windowId, fromDay, toDay, reason.slice(0, 300)]))).rows[0].id; }
  catch (e) { mapLeaveError(e); }
  const what = fromDay && toDay ? `${md(fromDay)} → ${md(toDay)} に変更` : fromDay ? `${md(fromDay)} をやめる` : `${md(toDay as string)} を追加`;
  const status = me.level >= 3 ? "pending_office" : "pending_manager";
  const to = status === "pending_office" ? await officeIds(db, me.companyId) : await managersOf(db, me.storeId, me.companyId);
  await leaveNotify(db, me.companyId, to.filter((x) => x !== userId), `有給の変更の申請（${me.name} さん）`, `${what}${reason ? `　理由：${reason.slice(0, 60)}` : ""}。${status === "pending_office" ? "許可してください。" : "確認してください。"}`, "/leave/review");
  return id;
}

export async function decideLeaveChange(db: Database, userId: string, id: string, approve: boolean, comment: string): Promise<LeaveStatus> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  let st: LeaveStatus;
  try { st = (await asUser(db, userId, (q) => q.query<{ s: LeaveStatus }>("select public.leave_decide($1, $2, $3) as s", [id, approve, comment.slice(0, 300)]))).rows[0].s; }
  catch (e) { mapLeaveError(e); }
  const c = (await db.query<{ membership_id: string; store_id: string; company_id: string; from_day: string | null; to_day: string | null; name: string }>(
    "select c.membership_id, c.store_id, c.company_id, c.from_day::text as from_day, c.to_day::text as to_day, m.name from leave_changes c join memberships m on m.id = c.membership_id where c.id = $1", [id])).rows[0];
  if (c) {
    const what = c.from_day && c.to_day ? `${md(c.from_day)} → ${md(c.to_day)}` : c.from_day ? `${md(c.from_day)} をやめる` : `${md(c.to_day as string)} を追加`;
    if (st === "rejected" && me.level === 3) await leaveNotify(db, c.company_id, [c.membership_id], "有給の変更が、店長の確認で却下されました", `${what}${comment ? `　コメント：${comment.slice(0, 80)}` : ""}`, "/leave");
    else if (st === "pending_office") await leaveNotify(db, c.company_id, await officeIds(db, c.company_id), `有給の変更：店長が確認しました（${c.name} さん）`, `${what}。許可してください。`, "/leave/review");
    else if (st === "approved" || st === "rejected") {
      await leaveNotify(db, c.company_id, [c.membership_id], st === "approved" ? "有給の変更が許可されました" : "有給の変更が却下されました", `${what}${comment ? `　コメント：${comment.slice(0, 80)}` : ""}`, "/leave");
      await leaveNotify(db, c.company_id, (await managersOf(db, c.store_id, c.company_id)).filter((x) => x !== c.membership_id), `有給の変更が${st === "approved" ? "許可" : "却下"}されました（${c.name} さん）`, what, "/leave/review");
    }
  }
  return st;
}
export async function cancelLeaveChange(db: Database, userId: string, id: string): Promise<void> {
  const ok = (await asUser(db, userId, (q) => q.query<{ ok: boolean }>("select public.leave_cancel($1) as ok", [id]))).rows[0].ok;
  if (!ok) throw new ForbiddenError();
}

/** 確認が必要な申請（店長=自店の「店長の確認待ち」／事務員さん=「許可待ち」と、確認待ちの店長分）と、最近の結果 */
export async function listLeaveReview(db: Database, userId: string): Promise<{ todo: LeaveChange[]; recent: LeaveChange[] }> {
  const me = await getMe(db, userId);
  if (!me || me.level < 3) throw new ForbiddenError();
  const rows = (await asUser(db, userId, (q) => q.query<LeaveChange>(`${CHANGE_SQL} order by c.created_at desc limit 80`))).rows;
  const mine = (c: LeaveChange) => c.membershipId === userId;
  const todo = rows.filter((c) => !mine(c) && ((c.status === "pending_manager" && (me.level === 4 || c.storeId === me.storeId)) || (c.status === "pending_office" && me.level === 4)));
  const recent = rows.filter((c) => !todo.includes(c)).slice(0, 30);
  return { todo, recent };
}

export interface LeaveOverviewStore { storeId: string; storeName: string; people: { id: string; name: string; submitted: boolean; days: string[] }[] }
export async function leaveOverview(db: Database, userId: string, windowId: string): Promise<LeaveOverviewStore[]> {
  const me = await getMe(db, userId);
  if (!me || me.level < 3) throw new ForbiddenError();
  return asUser(db, userId, async (q) => {
    const stores = (await q.query<{ id: string; name: string }>("select id, name from stores where status = 'active' order by sort_order, name")).rows.filter((s) => me.level === 4 || s.id === me.storeId);
    const people = (await q.query<{ id: string; name: string; store_id: string }>("select id, name, store_id from memberships where status = 'active' and not display_only and level < 4 order by employee_code")).rows;
    const plans = (await q.query<{ membership_id: string; day: string }>("select membership_id, day::text as day from leave_plans where window_id = $1 order by day", [windowId])).rows;
    const subs = new Set((await q.query<{ membership_id: string }>("select membership_id from leave_submissions where window_id = $1", [windowId])).rows.map((r) => r.membership_id));
    return stores.map((s) => ({ storeId: s.id, storeName: s.name, people: people.filter((p) => p.store_id === s.id).map((p) => ({ id: p.id, name: p.name, submitted: subs.has(p.id), days: plans.filter((x) => x.membership_id === p.id).map((x) => x.day) })) }));
  });
}


// ------------------------------------------------------------------ 指名売上（月ごと・個人ごと）
export interface SalesValues {
  total: number; free: number; nominated: number; retail: number; retailCount: number; customers: number; newCustomers: number; repeatCustomers: number;
  kitsukeCount: number; kitsukeSales: number; makeupCount: number; makeupSales: number; spaCount: number; spaSales: number;
}
export type SalesStatus = "draft" | "submitted" | "manager_ok" | "office_ok" | "returned";
export const SALES_STATUS_LABEL: Record<SalesStatus, string> = {
  draft: "下書き（まだ提出していません）", submitted: "提出済み（店長の確認待ち）", manager_ok: "店長確認済み（事務員さんの確認待ち）", office_ok: "確定", returned: "差し戻し（直して、もう一度提出）",
};
export interface SalesRow extends SalesValues { membershipId: string; name: string; source: string | null; status: SalesStatus | null; returnComment: string | null; commission: number | null }
export const EMPTY_SALES: SalesValues = { total: 0, free: 0, nominated: 0, retail: 0, retailCount: 0, customers: 0, newCustomers: 0, repeatCustomers: 0, kitsukeCount: 0, kitsukeSales: 0, makeupCount: 0, makeupSales: 0, spaCount: 0, spaSales: 0 };
export interface SalesRates { retail: number; kitsuke: number; makeup: number; spa: number }
export const DEFAULT_SALES_RATES: SalesRates = { retail: 10, kitsuke: 25, makeup: 20, spa: 20 };
const monthStart = (m: string) => { if (!/^\d{4}-\d{2}(-01)?$/.test(m)) throw new Error("月が正しくありません"); return `${m.slice(0, 7)}-01`; };
const prevYear = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
const SALES_COLS = `x.total_sales as total, x.free_sales as free, x.nominated_sales as nominated, x.retail_sales as retail, x.retail_count as "retailCount", x.customers, x.new_customers as "newCustomers", x.repeat_customers as "repeatCustomers",
  x.kitsuke_count as "kitsukeCount", x.kitsuke_sales as "kitsukeSales", x.makeup_count as "makeupCount", x.makeup_sales as "makeupSales", x.spa_count as "spaCount", x.spa_sales as "spaSales"`;
const pickVals = (r: SalesValues): SalesValues => ({ total: r.total, free: r.free, nominated: r.nominated, retail: r.retail, retailCount: r.retailCount, customers: r.customers, newCustomers: r.newCustomers, repeatCustomers: r.repeatCustomers, kitsukeCount: r.kitsukeCount, kitsukeSales: r.kitsukeSales, makeupCount: r.makeupCount, makeupSales: r.makeupSales, spaCount: r.spaCount, spaSales: r.spaSales });
const lastDayOf = (m: string) => { const [y, mo] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))]; return `${m.slice(0, 7)}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; };
export async function getSalesRates(db: Database, userId: string): Promise<SalesRates> {
  const rows = (await asUser(db, userId, (q) => q.query<{ item: keyof SalesRates; percent: string }>("select item, percent::text as percent from sales_rates"))).rows;
  const out = { ...DEFAULT_SALES_RATES };
  for (const r of rows) out[r.item] = Number(r.percent);
  return out;
}
/** 歩合の割合を変える（管理者） */
export async function setSalesRates(db: Database, userId: string, rates: SalesRates): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  for (const [k, v] of Object.entries(rates)) if (!["retail", "kitsuke", "makeup", "spa"].includes(k) || typeof v !== "number" || v < 0 || v > 100) throw new Error("割合は、0〜100%で入れてください");
  await asUser(db, userId, async (q) => { for (const [k, v] of Object.entries(rates)) await q.query("insert into sales_rates (company_id, item, percent) values ($1,$2,$3) on conflict (company_id, item) do update set percent = excluded.percent, updated_at = now()", [me.companyId, k, v]); });
}

/** 店長・管理者の入力画面: そのお店の全員（0円の人も）の、その月の数字と、前年同月の数字・目標 */
export async function listSalesMonth(db: Database, userId: string, storeId: string, month: string): Promise<{
  month: string; rows: SalesRow[]; prev: Record<string, SalesValues>; storeTarget: number | null; targets: Record<string, number>; board: boolean; images: { id: string; at: string; by: string | null }[];
  rates: SalesRates; dueOn: string; dueIsDefault: boolean;
}> {
  const m = monthStart(month);
  return asUser(db, userId, async (q) => {
    const people = (await q.query<{ id: string; name: string }>("select id, name from memberships where store_id = $1 and status = 'active' and not display_only and level < 4 order by employee_code", [storeId])).rows;
    const cur = (await q.query<SalesValues & { mid: string; source: string; status: SalesStatus; rc: string | null; ca: number | null }>(`select x.membership_id as mid, x.source, x.status, x.return_comment as rc, x.commission_amount as ca, ${SALES_COLS} from sales_stats x where x.store_id = $1 and x.month = $2`, [storeId, m])).rows;
    const prev = (await q.query<SalesValues & { mid: string }>(`select x.membership_id as mid, ${SALES_COLS} from sales_stats x where x.store_id = $1 and x.month = $2`, [storeId, prevYear(m)])).rows;
    const tg = (await q.query<{ membership_id: string | null; target: number }>("select membership_id, target from sales_targets where store_id = $1 and month = $2", [storeId, m])).rows;
    const board = (await q.query<{ b: boolean }>("select sales_board_public as b from stores where id = $1", [storeId])).rows[0]?.b ?? true;
    const images = (await q.query<{ id: string; at: string; by: string | null }>(
      "select i.id, i.created_at as at, u.name as by from sales_images i left join memberships u on u.id = i.created_by where i.store_id = $1 and i.month = $2 order by i.created_at", [storeId, m])).rows;
    const byId = new Map(cur.map((r) => [r.mid, r]));
    const rates = { ...DEFAULT_SALES_RATES };
    for (const x of (await q.query<{ item: keyof SalesRates; percent: string }>("select item, percent::text as percent from sales_rates")).rows) rates[x.item] = Number(x.percent);
    const dl = (await q.query<{ due_on: string }>("select due_on::text as due_on from sales_deadlines where store_id = $1 and month = $2", [storeId, m])).rows[0];
    return {
      month: m, board, images,
      rows: people.map((p) => { const r = byId.get(p.id); return { membershipId: p.id, name: p.name, source: r?.source ?? null, status: r?.status ?? null, returnComment: r?.rc ?? null, commission: r?.ca ?? null, ...(r ? pickVals(r) : EMPTY_SALES) }; }),
      prev: Object.fromEntries(prev.map((r) => [r.mid, pickVals(r)])),
      rates, dueOn: dl?.due_on ?? lastDayOf(m), dueIsDefault: !dl,
      storeTarget: tg.find((t) => t.membership_id === null)?.target ?? null,
      targets: Object.fromEntries(tg.filter((t) => t.membership_id).map((t) => [t.membership_id as string, t.target])),
    };
  });
}

function checkSales(v: SalesValues) {
  for (const [k, n] of Object.entries(v)) if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) throw new Error(`数字は、0以上の整数で入れてください（${k}）`);
}

/** 数字を保存（複数人まとめて。1人でも失敗したら全員取り消し）。店長=自店・管理者=全店 */
export async function saveSales(db: Database, userId: string, storeId: string, month: string, rows: { membershipId: string; values: SalesValues }[], source: "manual" | "photo" | "import" = "manual"): Promise<number> {
  const m = monthStart(month);
  if (rows.length > 200) throw new Error("一度に保存できるのは200人までです");
  rows.forEach((r) => checkSales(r.values));
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  // 前年などの取り込みは、管理者なら、そのまま確定にする（毎回の確認は要らない）
  const importFinal = source === "import" && me.level === 4;
  try {
    await asUser(db, userId, async (q) => {
      for (const r of rows) {
        const v = r.values;
        const st = (await q.query<{ status: SalesStatus }>("select status from sales_stats where membership_id = $1 and month = $2 and store_id = $3", [r.membershipId, m, storeId])).rows[0]?.status;
        if (st === "office_ok" && !importFinal) throw new Error("locked");
        const ex = await q.query(
          `update sales_stats set total_sales=$3, free_sales=$4, nominated_sales=$5, retail_sales=$6, customers=$7, new_customers=$8, repeat_customers=$9, source=$10, updated_by=$11, updated_at=now(),
                  retail_count=$14, kitsuke_count=$15, kitsuke_sales=$16, makeup_count=$17, makeup_sales=$18, spa_count=$19, spa_sales=$20,
                  status = case when $13::boolean then 'office_ok' when status in ('draft','returned') then 'submitted' else status end,
                  submitted_at = case when status in ('draft','returned') then now() else submitted_at end
            where membership_id = $1 and month = $2 and store_id = $12 returning id`,
          [r.membershipId, m, v.total, v.free, v.nominated, v.retail, v.customers, v.newCustomers, v.repeatCustomers, source, userId, storeId, importFinal, v.retailCount, v.kitsukeCount, v.kitsukeSales, v.makeupCount, v.makeupSales, v.spaCount, v.spaSales]);
        if (ex.rows.length === 0)
          await q.query(
            `insert into sales_stats (company_id, store_id, membership_id, month, total_sales, free_sales, nominated_sales, retail_sales, customers, new_customers, repeat_customers, source, updated_by, status, submitted_at,
                retail_count, kitsuke_count, kitsuke_sales, makeup_count, makeup_sales, spa_count, spa_sales)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15,$16,$17,$18,$19,$20,$21)`,
            [me.companyId, storeId, r.membershipId, m, v.total, v.free, v.nominated, v.retail, v.customers, v.newCustomers, v.repeatCustomers, source, userId, importFinal ? "office_ok" : "submitted", v.retailCount, v.kitsukeCount, v.kitsukeSales, v.makeupCount, v.makeupSales, v.spaCount, v.spaSales]);
      }
    });
  } catch (e) {
    if ((e as Error).message?.includes("整数")) throw e;
    if ((e as Error).message === "locked") throw new Error("確定した売上は、直接は直せません。先に「差し戻し」をしてください");
    throw new ForbiddenError("この売上を入れる権限がないか、対象の人が正しくありません");
  }
  return rows.length;
}

/** 本人の記入（下書き・差し戻しのときだけ）。まだ提出ではない */
export async function saveMySales(db: Database, userId: string, month: string, v: SalesValues): Promise<void> {
  const m = monthStart(month); checkSales(v);
  try { await asUser(db, userId, (q) => q.query("select public.sales_save_own($1::date, $2::jsonb)", [m, JSON.stringify(v)])); }
  catch (e) { if (/locked/.test((e as Error).message)) throw new Error("提出したあとは直せません（直したいときは、店長に差し戻してもらってください）"); throw new ForbiddenError(); }
}

const jpMonth = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
/** 提出 → 店長（いなければ事務員さん）に通知 */
export async function submitMySales(db: Database, userId: string, month: string): Promise<SalesStatus> {
  const m = monthStart(month);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  let st: SalesStatus;
  try { st = (await asUser(db, userId, (q) => q.query<{ s: SalesStatus }>("select public.sales_submit($1::date) as s", [m]))).rows[0].s; }
  catch (e) {
    if (/no data/.test((e as Error).message)) throw new Error("先に、数字を入れて保存してください");
    if (/locked/.test((e as Error).message)) throw new Error("すでに提出しています");
    throw new ForbiddenError();
  }
  const to = st === "manager_ok" ? await officeIds(db, me.companyId) : await managersOf(db, me.storeId, me.companyId);
  await leaveNotify(db, me.companyId, to.filter((x) => x !== userId), `${jpMonth(m)}の売上が提出されました（${me.name} さん）`, st === "manager_ok" ? "事務員さんの確認をお願いします。" : "店長の確認をお願いします。", "/sales");
  return st;
}

/** 確認／確定／差し戻し。action: manager_ok | office_ok | return */
export async function reviewSales(db: Database, userId: string, memberId: string, month: string, action: "manager_ok" | "office_ok" | "return", comment = ""): Promise<SalesStatus> {
  const m = monthStart(month);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  let st: SalesStatus;
  try { st = (await asUser(db, userId, (q) => q.query<{ s: SalesStatus }>("select public.sales_review($1, $2::date, $3, $4) as s", [memberId, m, action, comment.slice(0, 300)]))).rows[0].s; }
  catch (e) {
    const msg = (e as Error).message ?? "";
    if (/wrong status/.test(msg)) throw new Error(action === "office_ok" ? "先に、店長の確認が必要です" : "この売上は、いまの状態では、この操作ができません");
    if (/own/.test(msg)) throw new Error("自分の売上は、自分では確認できません");
    throw new ForbiddenError();
  }
  const who = (await db.query<{ name: string; company_id: string }>("select name, company_id from memberships where id = $1", [memberId])).rows[0];
  if (who) {
    if (st === "manager_ok") await leaveNotify(db, who.company_id, await officeIds(db, who.company_id), `${jpMonth(m)}の売上：店長が確認しました（${who.name} さん）`, "事務員さんの確定をお願いします。", "/sales");
    else if (st === "office_ok") await leaveNotify(db, who.company_id, [memberId], `${jpMonth(m)}の売上が確定しました`, "ありがとうございました。", "/my-sales");
    else if (st === "returned") await leaveNotify(db, who.company_id, [memberId], `${jpMonth(m)}の売上が差し戻されました`, comment ? `コメント：${comment.slice(0, 80)}` : "直して、もう一度提出してください。", "/my-sales");
  }
  return st;
}

/** 目標（お店 or 個人）。null で消す */
export async function setSalesTarget(db: Database, userId: string, storeId: string, month: string, membershipId: string | null, target: number | null): Promise<void> {
  const m = monthStart(month);
  if (target !== null && (!Number.isInteger(target) || target < 0 || target > 1_000_000_000)) throw new Error("目標は、0円以上の整数で入れてください");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      await q.query("delete from sales_targets where store_id = $1 and month = $2 and membership_id is not distinct from $3::uuid", [storeId, m, membershipId]);
      if (target !== null) await q.query("insert into sales_targets (company_id, store_id, membership_id, month, target, updated_by) values ($1,$2,$3,$4,$5,$6)", [me.companyId, storeId, membershipId, m, target, userId]);
    });
  } catch { throw new ForbiddenError(); }
}

export interface MySales {
  month: string; status: SalesStatus | null; returnComment: string | null; commission: number | null; rates: SalesRates; dueOn: string; mine: (SalesValues & { source: string }) | null; prev: SalesValues | null;
  store: { total: number; customers: number }; storePrev: { total: number; customers: number };
  target: number | null; storeTarget: number | null;
  board: { membershipId: string; name: string; total: number; customers: number; rank: number }[];
  series: { month: string; total: number; customers: number }[];     // 直近24か月の、自分の売上
}
/** 自分の売上のページ（本人）。お店の合計・前年・目標・ランキング・24か月の推移 */
export async function getMySales(db: Database, userId: string, month: string): Promise<MySales> {
  const m = monthStart(month);
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  return asUser(db, userId, async (q) => {
    const one = async (mm: string) => (await q.query<SalesValues & { source: string; status: SalesStatus; rc: string | null; ca: number | null }>(`select x.source, x.status, x.return_comment as rc, x.commission_amount as ca, ${SALES_COLS} from sales_stats x where x.membership_id = $1 and x.month = $2`, [userId, mm])).rows[0] ?? null;
    const restricted = me.level < 2;   // 一般のスタッフは、自分の分の記入と提出だけ（お店の合計・順位・目標は見せない）
    const tot = async (mm: string) => restricted ? { total: 0, customers: 0 } : (await q.query<{ total: number; customers: number }>("select total_sales as total, customers from public.sales_store_total($1, $2::date)", [me.storeId, mm])).rows[0] ?? { total: 0, customers: 0 };
    const tg = (await q.query<{ membership_id: string | null; target: number }>("select membership_id, target from sales_targets where store_id = $1 and month = $2 and (membership_id is null or membership_id = $3)", [me.storeId, m, userId])).rows;
    const board = restricted ? [] : (await q.query<{ membership_id: string; name: string; total_sales: number; customers: number; rank: number }>("select * from public.sales_board($1, $2::date)", [me.storeId, m])).rows;
    const series = (await q.query<{ month: string; total: number; customers: number }>(
      "select to_char(month, 'YYYY-MM') as month, total_sales as total, customers from sales_stats where membership_id = $1 and month >= ($2::date - interval '23 months') and month <= $2::date order by month", [userId, m])).rows;
    const prevRow = await one(prevYear(m));
    const mineRow = await one(m);
    const rates = { ...DEFAULT_SALES_RATES };
    for (const x of (await q.query<{ item: keyof SalesRates; percent: string }>("select item, percent::text as percent from sales_rates")).rows) rates[x.item] = Number(x.percent);
    const dl = (await q.query<{ due_on: string }>("select due_on::text as due_on from sales_deadlines where store_id = $1 and month = $2", [me.storeId, m])).rows[0];
    return {
      month: m, status: mineRow?.status ?? null, returnComment: mineRow?.rc ?? null, commission: mineRow?.ca ?? null, rates, dueOn: dl?.due_on ?? lastDayOf(m), mine: mineRow, prev: prevRow, store: await tot(m), storePrev: await tot(prevYear(m)),
      target: tg.find((t) => t.membership_id === userId)?.target ?? null, storeTarget: restricted ? null : tg.find((t) => t.membership_id === null)?.target ?? null,
      board: board.map((b) => ({ membershipId: b.membership_id, name: b.name, total: b.total_sales, customers: b.customers, rank: b.rank })), series,
    };
  });
}

export async function addSalesImage(db: Database, userId: string, storeId: string, month: string, mime: string, data: Buffer): Promise<string> {
  const m = monthStart(month);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("画像（JPEG・PNG・WebP）を選んでください");
  if (data.length === 0 || data.length > 3 * 1024 * 1024) throw new Error("画像が大きすぎます（3MBまで）");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    return (await asUser(db, userId, (q) => q.query<{ id: string }>(
      "insert into sales_images (company_id, store_id, month, mime, size, data, created_by) values ($1,$2,$3,$4,$5,decode($6::text,'hex'),$7) returning id",
      [me.companyId, storeId, m, mime, data.length, data.toString("hex"), userId]))).rows[0].id;
  } catch { throw new ForbiddenError(); }
}
export async function getSalesImage(db: Database, userId: string, id: string): Promise<{ mime: string; data: Buffer } | null> {
  const r = (await asUser(db, userId, (q) => q.query<{ mime: string; data: Uint8Array }>("select mime, data from sales_images where id = $1", [id]))).rows[0];
  return r ? { mime: r.mime, data: Buffer.from(r.data) } : null;
}
/** 店内ランキングを、スタッフにも見せる／見せない（管理者） */
export async function setSalesBoardPublic(db: Database, userId: string, storeId: string, on: boolean): Promise<void> {
  const r = await asUser(db, userId, (q) => q.query("update stores set sales_board_public = $2 where id = $1 returning id", [storeId, on])).catch(() => ({ rows: [] }));
  if (r.rows.length === 0) throw new ForbiddenError();
}


/** 歩合をつける（店長・シフト担当・管理者）。amount=null で取り消す。提出されたあと、確定の前まで */
export async function setSalesCommission(db: Database, userId: string, memberId: string, month: string, amount: number | null): Promise<void> {
  const m = monthStart(month);
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000)) throw new Error("歩合は、0円以上の整数で入れてください");
  try { await asUser(db, userId, (q) => q.query("select public.sales_set_commission($1, $2::date, $3)", [memberId, m, amount])); }
  catch (e) {
    const msg = (e as Error).message ?? "";
    if (/not submitted/.test(msg)) throw new Error("提出されたあとに、歩合をつけられます");
    if (/locked/.test(msg)) throw new Error("確定したあとは、歩合を変えられません（差し戻してから）");
    if (/own/.test(msg)) throw new Error("自分の歩合は、自分ではつけられません");
    throw new ForbiddenError();
  }
  if (amount !== null) await leaveNotify(db, (await getMe(db, userId))!.companyId, [memberId], `${jpMonth(m)}の歩合が決まりました`, `${amount.toLocaleString("ja-JP")}円`, "/my-sales");
}

/** 提出期限を決める（店長=自店・管理者=全店）。null で「月末」に戻す */
export async function setSalesDeadline(db: Database, userId: string, storeId: string, month: string, dueOn: string | null): Promise<void> {
  const m = monthStart(month);
  if (dueOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new Error("日付が正しくありません");
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  try {
    await asUser(db, userId, async (q) => {
      await q.query("delete from sales_deadlines where store_id = $1 and month = $2", [storeId, m]);
      if (dueOn) await q.query("insert into sales_deadlines (store_id, company_id, month, due_on, updated_by) values ($1,$2,$3,$4,$5)", [storeId, me.companyId, m, dueOn, userId]);
    });
  } catch { throw new ForbiddenError(); }
}

let lastSalesRemind = 0;
/**
 * 売上の提出期限の通知（毎日9:00ごろ以降・外から5分ごとに呼ばれる。同じものは1回だけ）
 *  start : 月はじめ（1日）に、全員へ「期限は◯日です」
 *  before: 期限の前日、まだ出していない人へ
 *  due   : 期限の日、まだ出していない人へ
 *  late  : 期限の翌日、期限を過ぎた人へ＋店長・事務員さんへ「未提出が◯人」
 */
export async function runSalesReminders(db: Database, force = false, at?: string): Promise<number> {
  if (!force && Date.now() - lastSalesRemind < 120_000) return 0;
  lastSalesRemind = Date.now();
  const now = at ?? new Date(Date.now() + 9 * 3600_000).toISOString();
  const today = now.slice(0, 10), hhmm = now.slice(11, 16);
  if (hhmm < "09:00") return 0;
  const addD = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const thisM = `${today.slice(0, 7)}-01`;
  const prevM = `${addD(thisM, -1).slice(0, 7)}-01`;
  const stores = (await db.query<{ id: string; name: string; company_id: string }>("select id, name, company_id from stores where status = 'active'")).rows;
  let sent = 0;
  for (const st of stores) {
    for (const month of [thisM, prevM]) {
      const due = (await db.query<{ due_on: string }>("select due_on::text as due_on from sales_deadlines where store_id = $1 and month = $2", [st.id, month])).rows[0]?.due_on ?? lastDayOf(month);
      const kinds: [string, boolean][] = [["start", month === thisM && today === month], ["before", today === addD(due, -1)], ["due", today === due], ["late", today === addD(due, 1)]];
      for (const [kind, hit] of kinds) {
        if (!hit) continue;
        const claim = await db.query("insert into sales_reminder_log (store_id, month, kind, sent_on) values ($1,$2,$3,$4::date) on conflict do nothing returning kind", [st.id, month, kind, today]);
        if (claim.rows.length === 0) continue;
        const people = (await db.query<{ id: string; name: string; status: SalesStatus | null }>(
          `select m.id, m.name, x.status from memberships m left join sales_stats x on x.membership_id = m.id and x.month = $2
            where m.store_id = $1 and m.status = 'active' and not m.display_only and m.level < 4`, [st.id, month])).rows;
        const notYet = people.filter((p) => !p.status || p.status === "draft" || p.status === "returned");
        const label = jpMonth(month), dueLabel = md(due);
        if (kind === "start") { await leaveNotify(db, st.company_id, people.map((p) => p.id), `${label}の売上の提出期限は ${dueLabel} です`, "自分の売上を記入して、期限までに提出してください。", "/my-sales"); sent += people.length; }
        else if (kind === "before" || kind === "due") { await leaveNotify(db, st.company_id, notYet.map((p) => p.id), kind === "before" ? `${label}の売上の提出は、明日（${dueLabel}）までです` : `${label}の売上の提出は、今日（${dueLabel}）までです`, "記入して「提出する」を押してください。", "/my-sales"); sent += notYet.length; }
        else if (kind === "late" && notYet.length > 0) {
          await leaveNotify(db, st.company_id, notYet.map((p) => p.id), `${label}の売上の提出期限（${dueLabel}）を過ぎています`, "なるべく早く、記入して提出してください。", "/my-sales");
          const mgrs = [...(await managersOf(db, st.id, st.company_id)), ...(await officeIds(db, st.company_id))];
          await leaveNotify(db, st.company_id, mgrs, `${st.name}：${label}の売上が未提出です（${notYet.length}人）`, notYet.map((p) => p.name).join("、").slice(0, 120), "/sales");
          sent += notYet.length;
        }
      }
    }
  }
  return sent;
}


// ------------------------------------------------------------------ セキュリティ（ログイン記録・操作の記録）
export interface LoginEventRow { at: string; ok: boolean; reason: string | null; ip: string | null; ua: string | null; code?: string | null; name?: string | null }
export interface AuditRow { at: string; action: string; actor: string | null; target: string | null; detail: unknown }
export interface SecurityOverview {
  mustChange: boolean; mine: LoginEventRow[];
  admin: null | { recent: LoginEventRow[]; failedByCode: { code: string; n: number }[]; audit: AuditRow[] };
}
export async function securityOverview(db: Database, userId: string): Promise<SecurityOverview> {
  const me = await getMe(db, userId);
  if (!me) throw new ForbiddenError();
  return asUser(db, userId, async (q) => {
    const mine = (await q.query<LoginEventRow>(
      `select at, ok, reason, ip, user_agent as ua from login_events where membership_id = $1 and ok order by at desc limit 12`, [userId])).rows;
    let admin: SecurityOverview["admin"] = null;
    if (me.level === 4) {
      const recent = (await q.query<LoginEventRow>(
        `select e.at, e.ok, e.reason, e.ip, e.user_agent as ua, e.employee_code as code, m.name from login_events e left join memberships m on m.id = e.membership_id order by e.at desc limit 120`)).rows;
      const failedByCode = (await q.query<{ code: string; n: number }>(
        `select employee_code as code, count(*)::int as n from login_events where not ok and at > now() - interval '24 hours' group by 1 order by n desc limit 10`)).rows;
      const audit = (await q.query<AuditRow>(
        `select a.at, a.action, ma.name as actor, mt.name as target, a.detail from audit_logs a left join memberships ma on ma.id = a.actor_id left join memberships mt on mt.id = a.target_id order by a.at desc limit 100`)).rows;
      admin = { recent, failedByCode, audit };
    }
    return { mustChange: !!me.mustChangePasscode, mine, admin };
  });
}


// ------------------------------------------------------------------ 税務署などに出す「全情報の書面」（管理者のみ）
export interface RecordsOptions { from: string; to: string; sections: string[]; detail?: boolean }
export const RECORD_SECTIONS: [string, string][] = [
  ["staff", "スタッフ名簿"], ["attendance", "出勤簿（月ごとのまとめ）"], ["sales", "売上と歩合"], ["materials", "材料費（発注の記録）"],
  ["stocktake", "棚卸し"], ["leave", "有給の提出と変更の記録"], ["lessons", "レッスン記録（回数）"], ["audit", "大切な操作の記録"],
];
export interface RecordsDoc {
  meta: { company: string; from: string; to: string; generatedAt: string; by: string; sections: string[]; detail: boolean; hash: string };
  staff?: Record<string, unknown>[]; attendance?: Record<string, unknown>[]; attendanceDaily?: Record<string, unknown>[]; sales?: Record<string, unknown>[];
  materials?: Record<string, unknown>[]; materialsByMonth?: Record<string, unknown>[]; stocktake?: Record<string, unknown>[]; stocktakeLines?: Record<string, unknown>[];
  leavePlans?: Record<string, unknown>[]; leaveChanges?: Record<string, unknown>[]; lessons?: Record<string, unknown>[]; audit?: Record<string, unknown>[];
}
/** 期間を決めて、全情報を1つにまとめる。出した記録は、操作の記録に残る。整合性コード（SHA-256）をつける */
export async function exportRecords(db: Database, userId: string, o: RecordsOptions): Promise<RecordsDoc> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.from) || !/^\d{4}-\d{2}-\d{2}$/.test(o.to) || o.to < o.from) throw new Error("期間が正しくありません");
  const sections = o.sections.filter((x) => RECORD_SECTIONS.some(([k]) => k === x));
  if (sections.length === 0) throw new Error("出す項目を1つ以上えらんでください");
  const has = (k: string) => sections.includes(k);
  const co = (await db.query<{ name: string }>("select name from companies where id = $1", [me.companyId])).rows[0]?.name ?? "";
  const staffRows = has("staff") ? (await db.query(`select m.employee_code as "社員番号", m.name as "氏名", s.name as "店舗", case m.level when 1 then 'スタッフ' when 2 then 'シフト担当' when 3 then '店長' else '管理者' end as "レベル", case when m.status = 'active' then '在籍' else '退職' end as "在籍", m.hired_on::text as "入社日", m.left_on::text as "退職日", m.retire_on::text as "退職予定日"
      from memberships m join stores s on s.id = m.store_id where m.company_id = $1 order by s.sort_order, m.employee_code`, [me.companyId])).rows : undefined;   // 管理用の接続（退職予定日は、アプリ用ロールからは読めないため）。会社で絞る
  const doc: Omit<RecordsDoc, "meta"> = await asUser(db, userId, async (q) => {
    const out: Omit<RecordsDoc, "meta"> = {};
    if (staffRows) out.staff = staffRows;
    if (has("attendance")) {
      out.attendance = (await q.query(`select to_char(a.day, 'YYYY-MM') as "月", s.name as "店舗", m.name as "氏名", count(*) filter (where a.kind = 'work')::int as "出勤日数", round(sum(a.work_minutes)::numeric / 60, 2)::float8 as "実働時間",
        count(*) filter (where a.kind = 'paid')::int as "有給日数", count(*) filter (where a.kind in ('holiday','off'))::int as "休みの日数"
        from attendance_records a join memberships m on m.id = a.membership_id join stores s on s.id = a.store_id where a.day between $1 and $2
        group by 1, s.name, m.name, s.sort_order, m.employee_code order by 1, s.sort_order, m.employee_code`, [o.from, o.to])).rows;
      if (o.detail) out.attendanceDaily = (await q.query(`select a.day::text as "日付", s.name as "店舗", m.name as "氏名", a.kind as "種類", to_char(a.clock_in, 'HH24:MI') as "入店", to_char(a.clock_out, 'HH24:MI') as "退店", a.break_minutes as "休憩(分)", a.work_minutes as "実働(分)"
        from attendance_records a join memberships m on m.id = a.membership_id join stores s on s.id = a.store_id where a.day between $1 and $2 order by a.day, s.sort_order, m.employee_code`, [o.from, o.to])).rows;
    }
    if (has("sales")) out.sales = (await q.query(`select to_char(x.month, 'YYYY-MM') as "月", s.name as "店舗", m.name as "氏名", case x.status when 'draft' then '下書き' when 'submitted' then '提出済み' when 'manager_ok' then '店長確認済み' when 'office_ok' then '確定' else '差し戻し' end as "状態", x.total_sales as "総合売上", x.free_sales as "フリー売上", x.nominated_sales as "指名技術売上",
        x.retail_sales as "店販売上", x.retail_count as "店販人数", x.customers as "客数", x.new_customers as "新規", x.repeat_customers as "再来",
        x.kitsuke_count as "着付け人数", x.kitsuke_sales as "着付け売上", x.makeup_count as "メイク人数", x.makeup_sales as "メイク売上", x.spa_count as "スパ人数", x.spa_sales as "スパ売上", x.commission_amount as "歩合"
        from sales_stats x join memberships m on m.id = x.membership_id join stores s on s.id = x.store_id where x.month between date_trunc('month', $1::date) and $2::date order by x.month, s.sort_order, m.employee_code`, [o.from, o.to])).rows;
    if (has("materials")) {
      out.materials = (await q.query(`select o.ordered_on::text as "発注日", s.name as "店舗", o.supplier as "発注先", o.item as "内容", case o.kind when 'supply' then '材料(業務)' when 'retail' then '店販' else 'その他' end as "種類",
        o.amount as "金額(税抜)", case o.tax_mode when 'in' then '税込で入力' else '税抜で入力' end as "入力", o.entered_amount as "入力した税込額", u.name as "記入した人", to_char(o.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as "記入日時",
        case when o.deleted_at is not null then '取り消し ' || to_char(o.deleted_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') else '' end as "取り消し", (select string_agg((l->>'name') || '×' || (l->>'qty') || ' ' || (l->>'amount') || '円', ' / ') from jsonb_array_elements(o.lines) l) as "明細"
        from material_orders o join stores s on s.id = o.store_id left join memberships u on u.id = o.created_by where o.ordered_on between $1 and $2 order by o.ordered_on, s.sort_order, o.created_at`, [o.from, o.to])).rows;
      out.materialsByMonth = (await q.query(`select to_char(o.ordered_on, 'YYYY-MM') as "月", s.name as "店舗", sum(o.amount)::bigint as "合計(税抜)", count(*)::int as "件数"
        from material_orders o join stores s on s.id = o.store_id where o.deleted_at is null and o.ordered_on between $1 and $2 group by 1, s.name, s.sort_order order by 1, s.sort_order`, [o.from, o.to])).rows;
    }
    if (has("stocktake")) {
      out.stocktake = (await q.query(`select t.taken_on::text as "棚卸日", s.name as "店舗", case t.kind when 'retail' then '店販' else '業務' end as "種類", case t.status when 'open' then '作成中' when 'submitted' then '提出済み' else '確認済み' end as "状態",
        coalesce(sum(l.amount), 0)::bigint as "棚卸金額(仕入値×数量)" from stocktakes t join stores s on s.id = t.store_id left join stocktake_lines l on l.stocktake_id = t.id
        where t.taken_on between $1 and $2 group by t.id, s.name, s.sort_order order by t.taken_on, s.sort_order`, [o.from, o.to])).rows;
      if (o.detail) out.stocktakeLines = (await q.query(`select t.taken_on::text as "棚卸日", s.name as "店舗", case t.kind when 'retail' then '店販' else '業務' end as "種類", l.maker as "メーカー", l.name as "品名", l.spec as "規格", l.cost_price as "仕入値", l.quantity as "数量", l.amount as "金額"
        from stocktake_lines l join stocktakes t on t.id = l.stocktake_id join stores s on s.id = t.store_id where t.taken_on between $1 and $2 order by t.taken_on, s.sort_order, l.sort_order`, [o.from, o.to])).rows;
    }
    if (has("leave")) {
      out.leavePlans = (await q.query(`select w.label as "回", s.name as "店舗", m.name as "氏名", p.day::text as "有給の日" from leave_plans p join leave_windows w on w.id = p.window_id join memberships m on m.id = p.membership_id join stores s on s.id = p.store_id
        where p.day between $1 and $2 order by p.day, s.sort_order, m.employee_code`, [o.from, o.to])).rows;
      out.leaveChanges = (await q.query(`select to_char(c.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as "申請日", w.label as "回", s.name as "店舗", m.name as "氏名", c.from_day::text as "変更前", c.to_day::text as "変更後", c.reason as "理由",
        case c.status when 'approved' then '許可' when 'rejected' then '却下' when 'cancelled' then '取り消し' when 'pending_manager' then '店長確認待ち' else '事務員確認待ち' end as "結果", mm.name as "店長", om.name as "事務員"
        from leave_changes c join leave_windows w on w.id = c.window_id join memberships m on m.id = c.membership_id join stores s on s.id = c.store_id left join memberships mm on mm.id = c.manager_id left join memberships om on om.id = c.office_id
        where c.created_at::date between $1 and $2 order by c.created_at`, [o.from, o.to])).rows;
    }
    if (has("lessons")) out.lessons = (await q.query(`select to_char(l.day, 'YYYY-MM') as "月", s.name as "店舗", m.name as "氏名", case when pc.name is null then c.name else pc.name || '・' || c.name end as "内容", count(*)::int as "回数", coalesce(sum(l.minutes), 0)::int as "時間(分)"
        from lesson_logs l join memberships m on m.id = l.assistant_id join stores s on s.id = l.store_id join lesson_categories c on c.id = l.category_id left join lesson_categories pc on pc.id = c.parent_id
        where l.deleted_at is null and l.day between $1 and $2 group by 1, s.name, s.sort_order, m.name, m.employee_code, pc.name, c.name order by 1, s.sort_order, m.employee_code`, [o.from, o.to])).rows;
    if (has("audit")) out.audit = (await q.query(`select to_char(a.at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as "日時", case a.action when 'staff.create' then 'スタッフを登録' when 'staff.update' then 'レベル・在籍を変更' when 'records.export' then '全情報の書面を作成' else a.action end as "操作", ma.name as "した人", mt.name as "対象の人", a.detail as "くわしく"
        from audit_logs a left join memberships ma on ma.id = a.actor_id left join memberships mt on mt.id = a.target_id where a.at::date between $1 and $2 order by a.at`, [o.from, o.to])).rows;
    return out;
  });
  const generatedAt = new Date().toISOString();
  const hash = createHash("sha256").update(JSON.stringify({ co, o: { ...o, sections }, doc })).digest("hex");
  await db.query("insert into audit_logs (company_id, actor_id, action, detail) values ($1,$2,'records.export',$3::jsonb)", [me.companyId, userId, JSON.stringify({ from: o.from, to: o.to, sections, detail: !!o.detail, hash: hash.slice(0, 16) })]);
  return { meta: { company: co, from: o.from, to: o.to, generatedAt, by: me.name, sections, detail: !!o.detail, hash }, ...doc };
}

// ---------------------------------------------------------------- ご要望（こうしてほしい）
export interface FeedbackRow { id: string; body: string; status: "new" | "read" | "done"; reply: string; createdAt: string; fromName: string }

/** ご要望を送る。アプリ制作者にお知らせ＋スマホ通知が届く */
export async function sendFeedback(db: Database, userId: string, body: string): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.displayOnly) throw new ForbiddenError();
  const text = body.trim();
  if (!text) throw new Error("内容を書いてください");
  if (text.length > 2000) throw new Error("長すぎます（2000字まで）");
  await asUser(db, userId, (q) => q.query("insert into feedback (company_id, from_id, body) values ($1,$2,$3)", [me.companyId, userId, text]));
  const owners = (await db.query<{ id: string }>("select id from memberships where company_id = $1 and app_owner and status = 'active'", [me.companyId])).rows.map((r) => r.id);
  for (const o of owners) await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'feedback',$3,$4,'/admin/feedback')", [me.companyId, o, `ご要望が届きました（${me.name}）`, text.slice(0, 80)]);
  await pushToUsers(db, owners, { title: `ご要望（${me.name}）`, body: text.slice(0, 80), url: "/admin/feedback", tag: "feedback" }).catch(() => 0);
}

/** 自分が送ったご要望（制作者は全員分） */
export async function listFeedback(db: Database, userId: string): Promise<FeedbackRow[]> {
  return (await asUser(db, userId, (q) => q.query<FeedbackRow>(
    `select f.id, f.body, f.status, f.reply, f.created_at::text as "createdAt", m.name as "fromName"
       from feedback f join memberships m on m.id = f.from_id order by f.created_at desc limit 200`))).rows;
}

/** 制作者だけ: 状態を変える・返事を書く */
export async function updateFeedback(db: Database, userId: string, id: string, input: { status?: "new" | "read" | "done"; reply?: string }): Promise<void> {
  const me = await getMe(db, userId);
  if (!me?.appOwner) throw new ForbiddenError();
  const n = (await asUser(db, userId, (q) => q.query(
    "update feedback set status = coalesce($2, status), reply = coalesce($3, reply), updated_at = now() where id = $1 returning from_id",
    [id, input.status ?? null, input.reply ?? null]))).rows;
  if (n.length === 0) throw new ForbiddenError();
  if (input.reply && input.reply.trim()) {
    await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'feedback',$3,$4,'/help')", [me.companyId, (n[0] as { from_id: string }).from_id, "ご要望に返事が届きました", input.reply.slice(0, 80)]);
  }
}

// ---------------------------------------------------------------- レジ売上（月間スタッフ売上表）
export interface RegisterSalesData {
  storeId: string; month: string; status: "none" | "entered" | "confirmed"; days: number;
  enteredAt: string | null; confirmedAt: string | null;
  rows: (RegisterRow & { membershipId: string | null })[];
}
const REG_COLS = `name, membership_id as "membershipId", tech_before as "techBefore", tech_discount as "techDiscount", tech_tax as "techTax", tech_total as "techTotal",
  goods_before as "goodsBefore", goods_discount as "goodsDiscount", goods_tax as "goodsTax", goods_total as "goodsTotal",
  all_before as "allBefore", all_discount as "allDiscount", all_tax as "allTax", all_total as "allTotal",
  new_count as "newCount", repeat_count as "repeatCount", fixed_count as "fixedCount", gobusata_count as "gobusataCount", guest_count as "guestCount", total_count as "totalCount"`;

/** そのお店・その月のレジ売上。見られるのは、そのお店の人と事務員さんだけ（DBが決める。他店は空） */
export async function getRegisterSales(db: Database, userId: string, storeId: string, month: string): Promise<RegisterSalesData> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月が正しくありません");
  const first = `${month}-01`;
  return asUser(db, userId, async (q) => {
    const st = (await q.query<{ status: "entered" | "confirmed"; days: number; enteredAt: string; confirmedAt: string | null }>(
      `select status, days, entered_at::text as "enteredAt", confirmed_at::text as "confirmedAt" from register_sales_status where store_id = $1 and month = $2`, [storeId, first])).rows[0];
    if (!st) return { storeId, month, status: "none" as const, days: 0, enteredAt: null, confirmedAt: null, rows: [] };
    const rows = (await q.query<RegisterSalesData["rows"][number]>(`select ${REG_COLS} from register_sales where store_id = $1 and month = $2 order by row_no`, [storeId, first])).rows
      .map((r) => ({ ...r, techBefore: Number(r.techBefore), techDiscount: Number(r.techDiscount), techTax: Number(r.techTax), techTotal: Number(r.techTotal), goodsBefore: Number(r.goodsBefore), goodsDiscount: Number(r.goodsDiscount), goodsTax: Number(r.goodsTax), goodsTotal: Number(r.goodsTotal), allBefore: Number(r.allBefore), allDiscount: Number(r.allDiscount), allTax: Number(r.allTax), allTotal: Number(r.allTotal) }));
    return { storeId, month, status: st.status, days: st.days, enteredAt: st.enteredAt, confirmedAt: st.confirmedAt, rows };
  });
}

async function registerNotify(db: Database, companyId: string, userIds: string[], title: string, body: string): Promise<void> {
  const ids = [...new Set(userIds)];
  for (const uid of ids) await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'register',$3,$4,'/register-sales')", [companyId, uid, title, body]);
  await pushToUsers(db, ids, { title, body, url: "/register-sales", tag: "register" }).catch(() => 0);
}

/** 入れる（シフト担当以上・自店／事務員さん・全店）。入れると、そのお店の人に見える。事務員さんに知らせが行く */
export async function saveRegisterSales(db: Database, userId: string, storeId: string, month: string, days: number, rows: RegisterRow[]): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.displayOnly || me.level < 2) throw new ForbiddenError();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月が正しくありません");
  if (rows.length === 0) throw new Error("表が空です");
  try {
    await asUser(db, userId, (q) => q.query("select public.register_save($1, $2, $3, $4::jsonb)", [storeId, `${month}-01`, days, JSON.stringify(rows)]));
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (m.includes("locked")) throw new Error("確認済みです。事務員さんが「入力済みにもどす」を押すと、直せます");
    if (m.includes("bad")) throw new Error("数字が正しくありません");
    throw new ForbiddenError();
  }
  const store = (await listStores(db, userId)).find((s) => s.id === storeId)?.name ?? "";
  const office = await officeIds(db, me.companyId);
  await registerNotify(db, me.companyId, office.filter((x) => x !== userId), `レジ売上が入りました（${store}）`, `${month.replace("-", "年")}月ぶん・${rows.length}行。確認してください`).catch(() => undefined);
}

/** 事務員さんの確認（on=確認済み／off=入力済みにもどす） */
export async function confirmRegisterSales(db: Database, userId: string, storeId: string, month: string, on: boolean): Promise<void> {
  const me = await getMe(db, userId);
  if (!me || me.level < 4) throw new ForbiddenError();
  try {
    await asUser(db, userId, (q) => q.query("select public.register_confirm($1, $2, $3)", [storeId, `${month}-01`, on]));
  } catch { throw new Error(on ? "確認できません（まだ入っていない、または確認済みです）" : "もどせません"); }
  if (on) {
    const store = (await listStores(db, userId)).find((s) => s.id === storeId)?.name ?? "";
    const staff = (await db.query<{ id: string }>("select id from memberships where store_id = $1 and level >= 2 and status = 'active'", [storeId])).rows.map((r) => r.id);
    await registerNotify(db, me.companyId, staff, `レジ売上が確認されました（${store}）`, `${month.replace("-", "年")}月ぶん。エクセルに出せます`).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- レッスンチェック表（採点）
export interface CheckItem { id: string; name: string; sortOrder: number; active: boolean }
export interface CheckSheet { id: string; grade: string; name: string; memo: string; maxPoints: number; passPoints: number; maxAttempts: number; sortOrder: number; active: boolean; items: CheckItem[] }
export interface CheckAttempt { id: string; sheetId: string; attemptNo: number; assessorName: string | null; time: string; comment: string; total: number; updatedAt: string; scores: Record<string, number> }
export interface CheckTrainee { id: string; name: string; rank: string | null; storeId: string; storeName: string }
export interface CheckData { sheets: CheckSheet[]; attempts: CheckAttempt[]; trainee: CheckTrainee | null; trainees: CheckTrainee[]; canAssess: boolean; canEditSheets: boolean }

/** 表と、受ける人の採点。受ける人を指定しなければ、自分（採点できる人は、お店の人の一覧つき） */
export async function getCheckData(db: Database, userId: string, traineeId?: string): Promise<CheckData> {
  const me = await getMe(db, userId);
  if (!me || me.displayOnly) throw new ForbiddenError();
  return asUser(db, userId, async (q) => {
    const sheetRows = (await q.query<Omit<CheckSheet, "items">>(
      `select id, grade, name, memo, max_points as "maxPoints", pass_points as "passPoints", max_attempts as "maxAttempts", sort_order as "sortOrder", active from check_sheets order by sort_order, name`)).rows;
    const itemRows = (await q.query<CheckItem & { sheetId: string }>(`select id, sheet_id as "sheetId", name, sort_order as "sortOrder", active from check_items order by sort_order`)).rows;
    const sheets: CheckSheet[] = sheetRows.map((s) => ({ ...s, items: itemRows.filter((i) => i.sheetId === s.id).map(({ sheetId: _s, ...i }) => i) }));
    // 採点できる人は、お店のスタッフの一覧（見えるのは、自店・事務員さんは全店）
    const canEditSheets = (await q.query<{ ok: boolean }>("select app.can_edit_checks() as ok")).rows[0].ok;
    const staff = (await q.query<CheckTrainee & { canAssess: boolean }>(
      `select m.id, m.name, m.rank, m.store_id as "storeId", s.name as "storeName", app.can_assess(m.store_id) as "canAssess"
         from memberships m join stores s on s.id = m.store_id
        where m.status = 'active' and not m.display_only order by s.sort_order, (m.rank = 'assistant') desc, m.name`)).rows;
    const assessable = staff.filter((x) => x.canAssess);
    const trainees: CheckTrainee[] = assessable.map(({ canAssess: _c, ...t }) => t);
    const targetId = traineeId ?? userId;
    const t = staff.find((x) => x.id === targetId) ?? null;
    if (!t || (t.id !== userId && !t.canAssess)) return { sheets, attempts: [], trainee: null, trainees, canAssess: false, canEditSheets };
    const attempts = (await q.query<Omit<CheckAttempt, "scores">>(
      `select a.id, a.sheet_id as "sheetId", a.attempt_no as "attemptNo", m.name as "assessorName", a.time_text as time, a.comment, a.total, a.updated_at::text as "updatedAt"
         from check_attempts a left join memberships m on m.id = a.assessor_id where a.trainee_id = $1 order by a.sheet_id, a.attempt_no`, [t.id])).rows;
    const sc = (await q.query<{ attemptId: string; itemId: string; score: number }>(
      `select s.attempt_id as "attemptId", s.item_id as "itemId", s.score from check_scores s join check_attempts a on a.id = s.attempt_id where a.trainee_id = $1`, [t.id])).rows;
    const { canAssess: ca, ...trainee } = t;
    return { sheets, attempts: attempts.map((a) => ({ ...a, scores: Object.fromEntries(sc.filter((x) => x.attemptId === a.id).map((x) => [x.itemId, x.score])) })), trainee, trainees, canAssess: ca, canEditSheets };
  });
}

export async function saveCheckAttempt(db: Database, userId: string, input: { sheetId: string; traineeId: string; attemptNo: number; time?: string; comment?: string; scores: { itemId: string; score: number }[] }): Promise<{ total: number; passed: boolean }> {
  const me = await getMe(db, userId);
  if (!me || me.displayOnly) throw new ForbiddenError();
  let r: { id: string; total: number; passed: boolean; store: string };
  try {
    r = (await asUser(db, userId, (q) => q.query<{ r: typeof r }>("select public.check_attempt_save($1,$2,$3,$4,$5,$6::jsonb) as r",
      [input.sheetId, input.traineeId, input.attemptNo, input.time ?? "", input.comment ?? "", JSON.stringify(input.scores)]))).rows[0].r;
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (m.includes("self")) throw new Error("自分の採点は、自分ではつけられません");
    if (m.includes("bad")) throw new Error("点数が正しくありません（0〜5）");
    throw new ForbiddenError();
  }
  const sh = (await db.query<{ name: string; pass: number; max: number }>("select name, pass_points as pass, max_points as max from check_sheets where id = $1", [input.sheetId])).rows[0];
  await pushNotifyOne(db, me.companyId, input.traineeId, `レッスンチェックの採点が入りました`, `${sh?.name ?? ""} ${input.attemptNo}回目：${r.total}点${r.passed ? "（合格！）" : `（合格は${sh?.pass ?? 0}点）`}`, "/lesson-check").catch(() => undefined);
  return { total: r.total, passed: r.passed };
}

async function pushNotifyOne(db: Database, companyId: string, userId: string, title: string, body: string, link: string): Promise<void> {
  await db.query("insert into notifications (company_id, user_id, kind, title, body, link) values ($1,$2,'lesson',$3,$4,$5)", [companyId, userId, title, body, link]);
  await pushToUsers(db, [userId], { title, body, url: link, tag: "lesson-check" }).catch(() => 0);
}

export async function deleteCheckAttempt(db: Database, userId: string, attemptId: string): Promise<void> {
  try { await asUser(db, userId, (q) => q.query("select public.check_attempt_delete($1)", [attemptId])); } catch { throw new ForbiddenError(); }
}

/** 表を直す・足す（事務員さん・教育担当）。items の並びが、そのまま順番 */
export async function saveCheckSheet(db: Database, userId: string, input: { id?: string; grade: string; name: string; memo: string; maxPoints: number; passPoints: number; maxAttempts: number; active: boolean; items: { id?: string; name: string }[] }): Promise<string> {
  try {
    return (await asUser(db, userId, (q) => q.query<{ id: string }>("select public.check_sheet_save($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as id",
      [input.id ?? null, input.grade, input.name, input.memo, input.maxPoints, input.passPoints, input.maxAttempts, input.active, JSON.stringify(input.items)]))).rows[0].id;
  } catch (e) {
    if (((e as Error).message ?? "").includes("bad")) throw new Error("表の内容が正しくありません（満点・合格点・回数を見直してください）");
    throw new ForbiddenError();
  }
}
