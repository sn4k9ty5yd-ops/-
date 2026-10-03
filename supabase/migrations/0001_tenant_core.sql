-- Phase 1: テナント基盤（会社・店舗・スタッフ・操作レベル）と Row Level Security
-- 特定のサービスに依存しない PostgreSQL 用。アプリは接続ごとに set_config('app.user_id', <スタッフID>, true) で
-- 「いま操作している人」を伝え、ロール app_user で接続する（RLSが効く）。

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then create role app_user nologin; end if;
end $$;

create schema if not exists app;

-- ---------------------------------------------------------------- tables

create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[a-z0-9-]{3,32}$'),  -- ログイン時の「会社ID」
  name       text not null,
  timezone   text not null default 'Asia/Tokyo',
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null,
  sort_order int  not null default 0,
  status     text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create index on public.stores (company_id);

-- 操作レベル(1-4)ごとの権限。scope: own=自店舗のみ / all=会社内の全店舗
create table public.level_permissions (
  level      smallint not null check (level between 1 and 4),
  permission text     not null,
  scope      text     not null check (scope in ('own', 'all')),
  primary key (level, permission)
);

create table public.memberships (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  store_id      uuid not null,
  employee_code text not null,                 -- ログイン用の社員番号
  name          text not null,
  email         text,                          -- 任意（ログインには使わない）
  passcode_hash text,                          -- scrypt。アプリ用ロールからは読めない
  failed_attempts int not null default 0,
  locked_until  timestamptz,
  level         smallint not null default 1 check (level between 1 and 4),
  status        text not null default 'active' check (status in ('active', 'disabled')),
  hired_on      date,
  left_on       date,
  created_at    timestamptz not null default now(),
  -- 店舗は必ず同じ会社のもの（他社の店舗に所属させられない）
  foreign key (store_id, company_id) references public.stores (id, company_id),
  unique (company_id, employee_code),
  unique (company_id, email)
);
create index on public.memberships (company_id, store_id);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  company_id uuid not null,
  actor_id   uuid,
  action     text not null,
  target_id  uuid,
  detail     jsonb,
  at         timestamptz not null default now()
);

-- ------------------------------------------------- helper functions
-- RLS の再帰を避けるため security definer。常に「今ログインしている人」だけを返す。

create function app.uid() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app.me() returns public.memberships
language sql stable security definer set search_path = public as $$
  select m.* from public.memberships m
  where m.id = app.uid() and m.status = 'active'
    and exists (select 1 from public.companies c where c.id = m.company_id and c.status = 'active')
$$;

create function app.my_company_id() returns uuid
language sql stable security definer set search_path = public as $$ select (app.me()).company_id $$;

create function app.my_level() returns smallint
language sql stable security definer set search_path = public as $$ select (app.me()).level $$;

-- 権限判定: レベル表に権限があり、scope=all か、対象店舗が自店舗であること
create function app.has_perm(perm text, target_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.level_permissions lp, app.me() me
    where lp.level = me.level and lp.permission = perm
      and (lp.scope = 'all' or me.store_id = target_store)
  )
$$;

-- ------------------------------------------------------ permission seed
insert into public.level_permissions (level, permission, scope) values
  (1, 'staff.view', 'own'), (2, 'staff.view', 'own'), (3, 'staff.view', 'all'), (4, 'staff.view', 'all'),
  (1, 'store.view', 'own'), (2, 'store.view', 'own'), (3, 'store.view', 'all'), (4, 'store.view', 'all'),
  (3, 'staff.manage', 'own'), (4, 'staff.manage', 'all'),
  (4, 'store.manage', 'all'),
  (4, 'level.assign', 'all');

-- ---------------------------------------------------------------- RLS
alter table public.companies         enable row level security;
alter table public.stores            enable row level security;
alter table public.level_permissions enable row level security;
alter table public.memberships       enable row level security;
alter table public.audit_logs        enable row level security;

create policy companies_select on public.companies
  for select to app_user using (id = app.my_company_id());

create policy stores_select on public.stores
  for select to app_user
  using (company_id = app.my_company_id() and app.has_perm('store.view', id));
create policy stores_insert on public.stores
  for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('store.manage', id));
create policy stores_update on public.stores
  for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('store.manage', id))
  with check (company_id = app.my_company_id() and app.has_perm('store.manage', id));

create policy level_permissions_select on public.level_permissions
  for select to app_user using (true);

create policy memberships_select on public.memberships
  for select to app_user
  using (company_id = app.my_company_id() and (id = app.uid() or app.has_perm('staff.view', store_id)));
create policy memberships_insert on public.memberships
  for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('staff.manage', store_id)
              and (app.my_level() = 4 or level < app.my_level()));
-- 自分より上のレベルの人（同レベル含む。オフィスを除く）は変更・無効化できない
create policy memberships_update on public.memberships
  for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('staff.manage', store_id)
         and (app.my_level() = 4 or level < app.my_level()))
  with check (company_id = app.my_company_id() and app.has_perm('staff.manage', store_id)
              and (app.my_level() = 4 or level < app.my_level()));
-- delete のポリシーは作らない（退職は status='disabled' で表す）

create policy audit_logs_select on public.audit_logs
  for select to app_user
  using (company_id = app.my_company_id() and app.my_level() = 4);

-- ------------------------------------------- guard + audit triggers
-- レベルの割り当て・変更は level.assign（=オフィスのみ）。会社の付け替えは禁止。
create function app.guard_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- ログイン中の人が操作する場合のみ検査（初期登録などサーバー側の管理処理は対象外）
  if app.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.company_id <> old.company_id then
    raise exception 'company_id cannot be changed';
  end if;
  if (tg_op = 'INSERT' and new.level <> 1) or (tg_op = 'UPDATE' and new.level <> old.level) then
    if not app.has_perm('level.assign', new.store_id) then
      raise exception 'only level 4 can assign levels';
    end if;
  end if;
  return new;
end $$;

create trigger memberships_guard before insert or update on public.memberships
  for each row execute function app.guard_membership();

create function app.audit_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'staff.create', new.id, jsonb_build_object('level', new.level));
  elsif new.level <> old.level or new.status <> old.status then
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'staff.update', new.id,
            jsonb_build_object('level', jsonb_build_array(old.level, new.level),
                               'status', jsonb_build_array(old.status, new.status)));
  end if;
  return new;
end $$;

create trigger memberships_audit after insert or update on public.memberships
  for each row execute function app.audit_membership();

-- ------------------------------------------------------------- sessions
-- ログイン状態。アプリ用ロール(app_user)には一切見せない（サーバーの管理用接続だけが使う）。
create table public.sessions (
  token_hash    text primary key,
  membership_id uuid not null references public.memberships(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index on public.sessions (membership_id);
alter table public.sessions enable row level security;  -- ポリシーなし＋権限なし

-- ------------------------------------------------------------- grants
grant usage on schema app to app_user;
grant execute on all functions in schema app to app_user;
grant select on public.companies, public.level_permissions, public.audit_logs to app_user;
grant select, insert, update on public.stores to app_user;
-- passcode_hash / failed_attempts / locked_until は列ごとの権限で隠す（RLSでは列は守れないため）
grant select (id, company_id, store_id, employee_code, name, email, level, status, hired_on, left_on, created_at)
  on public.memberships to app_user;
grant insert (company_id, store_id, employee_code, name, email, level, hired_on) on public.memberships to app_user;
grant update (store_id, employee_code, name, email, level, status, hired_on, left_on) on public.memberships to app_user;
-- anon（未ログイン）という扱いは無い。接続はすべて app_user か管理用ロール。
