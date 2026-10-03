-- Phase 5: 出勤簿（出勤・退勤・休憩・実働）と有給の残り日数

insert into public.level_permissions (level, permission, scope) values
  (3, 'attendance.view', 'all'), (4, 'attendance.view', 'all'),   -- 出勤簿を見る（スタッフ本人・シフト担当は見られない）
  (3, 'attendance.edit', 'own'), (4, 'attendance.edit', 'all'),   -- 出勤簿を書く・直す
  (3, 'leave.view', 'all'), (4, 'leave.view', 'all'),             -- 他の人の有給残りを見る（本人は自分のを見られる）
  (3, 'leave.manage', 'own'), (4, 'leave.manage', 'all');         -- 有給日数を付与・調整

-- 出勤簿の提出状況（店舗×期間）。シフトとは別に管理: 入力中 → 提出済み → 確認済み
alter table public.store_period_status
  add column attendance_status text not null default 'open' check (attendance_status in ('open','submitted','acknowledged'));
grant update (attendance_status) on public.store_period_status to app_user;

create or replace function app.guard_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare ra int; rb int;
begin
  new.updated_at := now();
  if app.uid() is null then return new; end if;   -- サーバー側の管理処理は対象外
  new.updated_by := app.uid();
  if tg_op = 'UPDATE' and new.status <> old.status then
    if app.status_rank(new.status) < app.status_rank(old.status) and app.my_level() < 4 then
      raise exception 'only level 4 can move the status backwards';
    end if;
    if new.status = 'acknowledged' and not app.has_perm('shift.acknowledge', new.store_id) then
      raise exception 'only the office can acknowledge';
    end if;
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'period.status', new.period_id,
            jsonb_build_object('store', new.store_id, 'from', old.status, 'to', new.status));
  end if;
  if tg_op = 'UPDATE' and new.attendance_status <> old.attendance_status then
    ra := array_position(array['open','submitted','acknowledged'], old.attendance_status);
    rb := array_position(array['open','submitted','acknowledged'], new.attendance_status);
    if rb < ra and app.my_level() < 4 then raise exception 'only level 4 can move the status backwards'; end if;
    if new.attendance_status = 'acknowledged' and not app.has_perm('shift.acknowledge', new.store_id) then
      raise exception 'only the office can acknowledge';
    end if;
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'attendance.status', new.period_id,
            jsonb_build_object('store', new.store_id, 'from', old.attendance_status, 'to', new.attendance_status));
  end if;
  return new;
end $$;

create table public.attendance_records (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  store_id      uuid not null,
  period_id     uuid not null,
  membership_id uuid not null references public.memberships(id),
  day           date not null,
  kind          text not null check (kind in ('work','paid','holiday','off','other')),  -- 出勤/有給/公休/休み/その他
  clock_in      time,
  clock_out     time,
  break_minutes int not null default 0 check (break_minutes >= 0),
  work_minutes  int generated always as (
    case when kind = 'work' then (extract(epoch from (clock_out - clock_in)) / 60)::int - break_minutes else 0 end) stored,
  note          text,
  edited        boolean not null default false,   -- 一人ずつ手で直した日（一括入力で上書きしない目印）
  source        text not null default 'manual' check (source in ('manual','shift','bulk')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  foreign key (period_id, company_id) references public.shift_periods (id, company_id),
  foreign key (store_id, company_id)  references public.stores (id, company_id),
  unique (membership_id, day),
  check ((kind = 'work' and clock_in is not null and clock_out is not null and clock_out > clock_in
          and break_minutes <= (extract(epoch from (clock_out - clock_in)) / 60)::int)
      or (kind <> 'work' and clock_in is null and clock_out is null and break_minutes = 0))
);
create index on public.attendance_records (company_id, period_id, store_id, day);

-- 編集できる状態: 入力中は権限のある人。提出後はオフィスのみ。確認済みは誰も不可
create function app.attendance_editable(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store
      and (sp.attendance_status = 'open' or (sp.attendance_status = 'submitted' and app.my_level() = 4))
  )
$$;

alter table public.attendance_records enable row level security;
create policy att_select on public.attendance_records
  for select to app_user using (company_id = app.my_company_id() and app.has_perm('attendance.view', store_id));
create policy att_insert on public.attendance_records
  for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('attendance.edit', store_id) and app.attendance_editable(period_id, store_id));
create policy att_update on public.attendance_records
  for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('attendance.edit', store_id) and app.attendance_editable(period_id, store_id))
  with check (company_id = app.my_company_id() and app.has_perm('attendance.edit', store_id) and app.attendance_editable(period_id, store_id));
create policy att_delete on public.attendance_records
  for delete to app_user
  using (company_id = app.my_company_id() and app.has_perm('attendance.edit', store_id) and app.attendance_editable(period_id, store_id));

create function app.guard_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.shift_periods; m public.memberships;
begin
  select * into p from public.shift_periods where id = new.period_id;
  if new.day < p.start_date or new.day > p.end_date then raise exception 'date is outside the period'; end if;
  select * into m from public.memberships where id = new.membership_id;
  if m.company_id <> new.company_id or m.store_id <> new.store_id then raise exception 'staff does not belong to this store'; end if;
  new.updated_at := now();
  new.updated_by := app.uid();
  return new;
end $$;
create trigger att_guard before insert or update on public.attendance_records
  for each row execute function app.guard_attendance();

-- 出勤簿の変更はすべて履歴に残す（誰が・いつ・何を）
create function app.audit_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.attendance_records;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
  values (r.company_id, app.uid(), 'attendance.' || lower(tg_op), r.membership_id,
          jsonb_build_object('day', r.day, 'before', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'after', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return r;
end $$;
create trigger att_audit after insert or update or delete on public.attendance_records
  for each row execute function app.audit_attendance();

grant select, insert, delete on public.attendance_records to app_user;
grant update (kind, clock_in, clock_out, break_minutes, note, edited, source) on public.attendance_records to app_user;

-- ------------------------------------------------------- 有給（手で入れる方式）
-- 付与・調整の履歴。残り日数 = 付与の合計 − 出勤簿で「有給」にした日数。取り消し・修正はマイナスの調整で行う（履歴を消さない）
create table public.paid_leave_grants (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  store_id      uuid not null,
  membership_id uuid not null references public.memberships(id),
  days          numeric(4,1) not null check (days <> 0 and days between -99 and 99),
  granted_on    date not null default current_date,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.paid_leave_grants (membership_id);
alter table public.paid_leave_grants enable row level security;
create policy leave_select on public.paid_leave_grants
  for select to app_user using (company_id = app.my_company_id() and (membership_id = app.uid() or app.has_perm('leave.view', store_id)));
create policy leave_insert on public.paid_leave_grants
  for insert to app_user with check (company_id = app.my_company_id() and app.has_perm('leave.manage', store_id));
-- 更新・削除のポリシーは作らない（履歴を残す）

create function app.guard_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = new.membership_id;
  if m.company_id <> new.company_id or m.store_id <> new.store_id then raise exception 'staff does not belong to this store'; end if;
  new.created_by := app.uid();
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
  values (new.company_id, app.uid(), 'leave.grant', new.membership_id, jsonb_build_object('days', new.days, 'note', new.note));
  return new;
end $$;
create trigger leave_guard before insert on public.paid_leave_grants
  for each row execute function app.guard_leave();
grant select, insert on public.paid_leave_grants to app_user;

-- 残り日数の集計。出勤簿は本人に見せないため、集計だけを本人にも返す（本人 または 見る権限がある人のみ）
create function app.leave_balances(p_store uuid)
returns table (membership_id uuid, granted numeric, used bigint, remaining numeric)
language sql stable security definer set search_path = public as $$
  select m.id,
         coalesce((select sum(g.days) from public.paid_leave_grants g where g.membership_id = m.id), 0),
         (select count(*) from public.attendance_records a where a.membership_id = m.id and a.kind = 'paid'),
         coalesce((select sum(g.days) from public.paid_leave_grants g where g.membership_id = m.id), 0)
           - (select count(*) from public.attendance_records a where a.membership_id = m.id and a.kind = 'paid')
    from public.memberships m
   where m.company_id = app.my_company_id() and m.store_id = p_store and m.status = 'active'
     and (m.id = app.uid() or app.has_perm('leave.view', p_store))
$$;
