-- Phase 3: シフト期間・店舗ごとの進行状況・希望休

insert into public.level_permissions (level, permission, scope) values
  (4, 'period.create', 'all'),                              -- 期間を作る
  (3, 'period.manage', 'own'), (4, 'period.manage', 'all'), -- 受付開始・締切・確定などの進行
  (4, 'shift.acknowledge', 'all'),                          -- 「確認済み」にする（オフィスのみ）
  (2, 'request.view', 'own'), (3, 'request.view', 'all'), (4, 'request.view', 'all'),  -- 他の人の希望休を見る
  (3, 'request.manage', 'own'), (4, 'request.manage', 'all');                          -- 希望休の代理入力・修正

-- 会社の締め日（16 = 16日〜翌月15日 / 1 = 1日〜月末）
alter table public.companies add column closing_start_day smallint not null default 16 check (closing_start_day between 1 and 28);

create table public.shift_periods (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  start_date date not null,
  end_date   date not null check (end_date >= start_date),
  label      text not null,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, start_date)
);

-- 進行状況は「店舗×期間」ごと
create table public.store_period_status (
  period_id         uuid not null,
  store_id          uuid not null,
  company_id        uuid not null,
  status            text not null default 'preparing'
    check (status in ('preparing','collecting','closed','drafting','confirmed','published','submitted','acknowledged')),
  request_open_at   timestamptz,
  request_close_at  timestamptz,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  primary key (period_id, store_id),
  foreign key (period_id, company_id) references public.shift_periods (id, company_id),
  foreign key (store_id, company_id)  references public.stores (id, company_id)
);

create table public.time_off_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  membership_id uuid not null,
  store_id      uuid not null,
  period_id     uuid not null,
  day           date not null,
  kind          text not null default 'hope' check (kind in ('hope','paid','holiday','other')),
  note          text,
  created_at    timestamptz not null default now(),
  foreign key (period_id, company_id) references public.shift_periods (id, company_id),
  foreign key (store_id, company_id)  references public.stores (id, company_id),
  foreign key (membership_id) references public.memberships (id),
  unique (membership_id, day)
);
create index on public.time_off_requests (company_id, period_id, store_id);

-- ------------------------------------------------------------ helpers
-- 順番（後戻りの判定用）
create function app.status_rank(s text) returns int language sql immutable as $$
  select array_position(array['preparing','collecting','closed','drafting','confirmed','published','submitted','acknowledged'], s)
$$;

-- 本人が希望休を出せる状態か（受付中で、受付期間内）
create function app.request_window_open(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store and sp.status = 'collecting'
      and (sp.request_open_at  is null or now() >= sp.request_open_at)
      and (sp.request_close_at is null or now() <  sp.request_close_at)
  )
$$;

-- 公開されたシフトを見てよいか（店舗×期間が「公開」以降）
create function app.is_published(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store
      and app.status_rank(sp.status) >= app.status_rank('published')
  )
$$;

-- ----------------------------------------------------------------- RLS
alter table public.shift_periods       enable row level security;
alter table public.store_period_status enable row level security;
alter table public.time_off_requests   enable row level security;

create policy periods_select on public.shift_periods
  for select to app_user using (company_id = app.my_company_id());
create policy periods_insert on public.shift_periods
  for insert to app_user with check (company_id = app.my_company_id() and app.has_perm('period.create', (app.me()).store_id));

create policy sps_select on public.store_period_status
  for select to app_user using (company_id = app.my_company_id() and app.has_perm('store.view', store_id));
create policy sps_insert on public.store_period_status
  for insert to app_user with check (company_id = app.my_company_id() and app.has_perm('period.create', store_id));
create policy sps_update on public.store_period_status
  for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('period.manage', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('period.manage', store_id));

-- 希望休: 本人のもの / 見る権限がある店舗のもの
create policy tor_select on public.time_off_requests
  for select to app_user
  using (company_id = app.my_company_id()
         and (membership_id = app.uid() or app.has_perm('request.view', store_id)));
-- 登録: 本人（受付中のみ・希望休/有給のみ）または代理入力の権限がある人
create policy tor_insert on public.time_off_requests
  for insert to app_user
  with check (company_id = app.my_company_id() and (
    (membership_id = app.uid() and kind in ('hope','paid') and app.request_window_open(period_id, store_id))
    or app.has_perm('request.manage', store_id)));
create policy tor_delete on public.time_off_requests
  for delete to app_user
  using (company_id = app.my_company_id() and (
    (membership_id = app.uid() and app.request_window_open(period_id, store_id))
    or app.has_perm('request.manage', store_id)));
-- 更新（備考・種類の変更）は代理入力の権限のみ。本人は削除→登録で行う

-- ------------------------------------------------------------ triggers
-- 希望休の整合性: 日付は期間内、店舗は本人の所属店舗、会社が同じ人
create function app.guard_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.shift_periods; m public.memberships;
begin
  select * into p from public.shift_periods where id = new.period_id;
  if new.day < p.start_date or new.day > p.end_date then
    raise exception 'date is outside the period';
  end if;
  select * into m from public.memberships where id = new.membership_id;
  if m.company_id <> new.company_id or m.store_id <> new.store_id then
    raise exception 'membership does not belong to this store';
  end if;
  return new;
end $$;
create trigger tor_guard before insert or update on public.time_off_requests
  for each row execute function app.guard_request();

-- 進行状況の変更: 後戻りはオフィスのみ。「確認済み」はオフィスのみ。履歴を残す
create function app.guard_status() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;
create trigger sps_guard before update on public.store_period_status
  for each row execute function app.guard_status();

-- ------------------------------------------------------------- grants
grant select, insert on public.shift_periods to app_user;
grant select, insert on public.store_period_status to app_user;
grant update (status, request_open_at, request_close_at) on public.store_period_status to app_user;
grant select, insert, update, delete on public.time_off_requests to app_user;
