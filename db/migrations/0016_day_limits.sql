-- 休みの上限（その日、何人まで休めるか）・かぶりの知らせ・話し合い。
-- 上限を決めるのはシフト担当・店長・管理者（シフトを作れる人）。希望休は、上限に関係なく出せる。
create table public.day_limits (
  period_id  uuid not null,
  store_id   uuid not null,
  company_id uuid not null,
  day        date not null,
  max_off    int  not null check (max_off >= 0 and max_off <= 99),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (period_id, store_id, day),
  foreign key (period_id, company_id) references public.shift_periods (id, company_id),
  foreign key (store_id, company_id)  references public.stores (id, company_id)
);
alter table public.day_limits enable row level security;
create policy day_limits_select on public.day_limits for select to app_user
  using (company_id = app.my_company_id() and (store_id = (app.me()).store_id or app.my_level() >= 3));
create policy day_limits_write on public.day_limits for all to app_user
  using (company_id = app.my_company_id() and app.has_perm('shift.edit', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('shift.edit', store_id));
grant select, insert, update, delete on public.day_limits to app_user;

-- お知らせ（アプリの中の受信箱）。自分のものだけ見られて、既読にできる。作るのはサーバー側。
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id    uuid not null references public.memberships(id),
  kind       text not null,
  title      text not null,
  body       text not null default '',
  link       text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy notif_select on public.notifications for select to app_user using (user_id = app.uid());
create policy notif_update on public.notifications for update to app_user using (user_id = app.uid()) with check (user_id = app.uid());
grant select on public.notifications to app_user;
grant update (read_at) on public.notifications to app_user;

-- その日に休みを希望している（または休みのシフトが入っている）人。見られるのは、当人たちと、シフトを見られる人だけ。
create function app.day_off_people(p uuid, s uuid, d date) returns table (membership_id uuid, kind text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.shift_periods sp where sp.id = p and sp.company_id = app.my_company_id()) then return; end if;
  return query
    with x as (
      select coalesce(sh.membership_id, r.membership_id) as m,
             coalesce(sh.kind, case r.kind when 'paid' then 'paid' else 'holiday' end) as k
        from (select * from public.shifts where period_id = p and store_id = s and day = d and kind <> 'work') sh
        full join (select * from public.time_off_requests where period_id = p and store_id = s and day = d) r on r.membership_id = sh.membership_id)
    select m, k from x
     where app.has_perm('shift.view', s) or exists (select 1 from x y where y.m = app.uid());
end $$;

-- 上限を超えている日（シフトを見られる人だけ）
create function app.period_conflicts(p uuid, s uuid) returns table (day date, max_off int, cnt int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not app.has_perm('shift.view', s) then return; end if;
  return query
    select l.day, l.max_off,
           (select count(*)::int from (
              select membership_id from public.shifts where period_id = p and store_id = s and day = l.day and kind <> 'work'
              union
              select membership_id from public.time_off_requests where period_id = p and store_id = s and day = l.day) u) as cnt
      from public.day_limits l
     where l.period_id = p and l.store_id = s and l.company_id = app.my_company_id()
       and (select count(*) from (
              select membership_id from public.shifts where period_id = p and store_id = s and day = l.day and kind <> 'work'
              union
              select membership_id from public.time_off_requests where period_id = p and store_id = s and day = l.day) u) > l.max_off
     order by l.day;
end $$;

-- 話し合い（その日ごと）。当人たちとシフトを見られる人が読み書きできる。
create table public.day_messages (
  id         bigint generated always as identity primary key,
  company_id uuid not null,
  period_id  uuid not null,
  store_id   uuid not null,
  day        date not null,
  user_id    uuid not null references public.memberships(id),
  body       text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index on public.day_messages (period_id, store_id, day, id);
alter table public.day_messages enable row level security;
create function app.day_involved(p uuid, s uuid, d date) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_perm('shift.view', s) or exists (select 1 from app.day_off_people(p, s, d) where membership_id = app.uid())
$$;
create policy day_messages_select on public.day_messages for select to app_user
  using (company_id = app.my_company_id() and app.day_involved(period_id, store_id, day));
create policy day_messages_insert on public.day_messages for insert to app_user
  with check (company_id = app.my_company_id() and user_id = app.uid() and app.day_involved(period_id, store_id, day));
grant select, insert on public.day_messages to app_user;
