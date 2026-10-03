-- Phase 6: 商品マスター（店販／業務）と棚卸し。棚卸しと在庫（材料）は同じ商品マスターを使う

insert into public.level_permissions (level, permission, scope) values
  (2, 'product.view', 'own'), (3, 'product.view', 'all'), (4, 'product.view', 'all'),   -- 商品一覧を見る
  (4, 'product.manage', 'all'),                                                         -- 商品の登録・編集・取扱い終了
  (2, 'stocktake.view', 'own'), (3, 'stocktake.view', 'all'), (4, 'stocktake.view', 'all'),
  (2, 'stocktake.edit', 'own'), (3, 'stocktake.edit', 'own'), (4, 'stocktake.edit', 'all'),    -- 数量を入れる
  (3, 'stocktake.manage', 'own'), (4, 'stocktake.manage', 'all');                              -- 棚卸しを始める・提出する

create table public.products (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind       text not null check (kind in ('retail','supply')),   -- 店販 / 業務
  maker      text not null default '',
  name       text not null check (length(trim(name)) > 0),
  spec       text not null default '',                            -- 規格
  cost_price int  not null default 0 check (cost_price >= 0),      -- 仕入値（税抜・円）
  status     text not null default 'active' check (status in ('active','discontinued')),
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create unique index products_unique on public.products (company_id, kind, maker, name, spec);
create index on public.products (company_id, kind, status);

-- どのお店で使う商品か（共通＝全店に付ける。専用＝1店舗だけ）
create table public.product_stores (
  product_id uuid not null,
  store_id   uuid not null,
  company_id uuid not null,
  primary key (product_id, store_id),
  foreign key (product_id, company_id) references public.products (id, company_id) on delete cascade,
  foreign key (store_id, company_id)   references public.stores (id, company_id)
);

create table public.stocktakes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  store_id        uuid not null,
  kind            text not null check (kind in ('retail','supply')),
  taken_on        date not null,                                -- 棚卸日（例 R8.10.31）
  status          text not null default 'open' check (status in ('open','submitted','acknowledged')),
  submitted_at    timestamptz, submitted_by uuid,
  acknowledged_at timestamptz, acknowledged_by uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id),
  unique (id, company_id),
  unique (store_id, kind, taken_on)
);

-- 棚卸しの1行。商品情報と仕入値は、その時点の値を写して保存する（あとで商品マスターを変えても過去の金額は変わらない）
create table public.stocktake_lines (
  id           uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null,
  company_id   uuid not null,
  store_id     uuid not null,
  product_id   uuid references public.products(id),
  maker        text not null default '',
  name         text not null,
  spec         text not null default '',
  cost_price   int  not null check (cost_price >= 0),
  quantity     int  check (quantity >= 0 and quantity <= 1000000),   -- 整数のみ。NULL＝未入力
  amount       bigint generated always as (cost_price::bigint * coalesce(quantity, 0)) stored,
  sort_order   int  not null default 0,
  foreign key (stocktake_id, company_id) references public.stocktakes (id, company_id) on delete cascade,
  unique (stocktake_id, product_id)
);
create index on public.stocktake_lines (stocktake_id);

create function app.stocktake_status(p_id uuid) returns text
language sql stable security definer set search_path = public as $$ select status from public.stocktakes where id = p_id $$;

alter table public.products          enable row level security;
alter table public.product_stores    enable row level security;
alter table public.stocktakes        enable row level security;
alter table public.stocktake_lines   enable row level security;

-- 商品: 見る権限がある人。店ごとの人（Lv2）は、自店で使う商品だけ
create policy products_select on public.products
  for select to app_user using (company_id = app.my_company_id() and (
    app.my_level() >= 3 or exists (select 1 from public.product_stores ps where ps.product_id = id and ps.store_id = (app.me()).store_id)) and app.my_level() >= 2);
create policy products_write on public.products
  for all to app_user
  using (company_id = app.my_company_id() and app.has_perm('product.manage', (app.me()).store_id))
  with check (company_id = app.my_company_id() and app.has_perm('product.manage', (app.me()).store_id));
create policy ps_select on public.product_stores
  for select to app_user using (company_id = app.my_company_id() and app.has_perm('product.view', store_id));
create policy ps_write on public.product_stores
  for all to app_user
  using (company_id = app.my_company_id() and app.has_perm('product.manage', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('product.manage', store_id));

-- 棚卸し
create policy st_select on public.stocktakes
  for select to app_user using (company_id = app.my_company_id() and app.has_perm('stocktake.view', store_id));
create policy st_insert on public.stocktakes
  for insert to app_user with check (company_id = app.my_company_id() and app.has_perm('stocktake.manage', store_id));
create policy st_update on public.stocktakes
  for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('stocktake.manage', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('stocktake.manage', store_id));
create policy st_delete on public.stocktakes
  for delete to app_user
  using (company_id = app.my_company_id() and status = 'open' and app.has_perm('stocktake.manage', store_id));

-- 入力できるのは、入力中（オフィスは提出後も）のみ。確認済みは誰も不可
create function app.stocktake_editable(p_id uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stocktakes s where s.id = p_id
    and (s.status = 'open' or (s.status = 'submitted' and app.my_level() = 4))
    and app.has_perm('stocktake.edit', p_store))
$$;
create policy sl_select on public.stocktake_lines
  for select to app_user using (company_id = app.my_company_id() and app.has_perm('stocktake.view', store_id));
create policy sl_insert on public.stocktake_lines
  for insert to app_user with check (company_id = app.my_company_id() and app.stocktake_editable(stocktake_id, store_id)
                                     and app.has_perm('stocktake.manage', store_id));   -- 行の追加（開始・商品追加）は管理権限
create policy sl_update on public.stocktake_lines
  for update to app_user
  using (company_id = app.my_company_id() and app.stocktake_editable(stocktake_id, store_id))
  with check (company_id = app.my_company_id() and app.stocktake_editable(stocktake_id, store_id));
create policy sl_delete on public.stocktake_lines
  for delete to app_user
  using (company_id = app.my_company_id() and app.stocktake_editable(stocktake_id, store_id) and app.has_perm('stocktake.manage', store_id));

-- 数量以外（商品名・仕入値など）は、あとから変えられない。数量だけ更新できる
create function app.guard_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and app.uid() is not null and (new.cost_price <> old.cost_price or new.name <> old.name or new.maker <> old.maker or new.spec <> old.spec) then
    raise exception 'only quantity can be changed';
  end if;
  return new;
end $$;
create trigger sl_guard before update on public.stocktake_lines for each row execute function app.guard_line();

-- 提出・確認の状態変更
create function app.guard_stocktake() returns trigger
language plpgsql security definer set search_path = public as $$
declare ra int; rb int; missing int;
begin
  if app.uid() is null then return new; end if;
  if tg_op = 'INSERT' then new.created_by := app.uid(); new.status := 'open'; return new; end if;
  if new.status <> old.status then
    ra := array_position(array['open','submitted','acknowledged'], old.status);
    rb := array_position(array['open','submitted','acknowledged'], new.status);
    if rb < ra and app.my_level() < 4 then raise exception 'only level 4 can move the status backwards'; end if;
    if new.status = 'acknowledged' and not app.has_perm('shift.acknowledge', new.store_id) then raise exception 'only the office can acknowledge'; end if;
    if new.status = 'submitted' then
      select count(*) into missing from public.stocktake_lines where stocktake_id = new.id and quantity is null;
      if missing > 0 then raise exception 'there are % items without a quantity', missing; end if;
      new.submitted_at := now(); new.submitted_by := app.uid();
    end if;
    if new.status = 'acknowledged' then new.acknowledged_at := now(); new.acknowledged_by := app.uid(); end if;
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'stocktake.status', new.id, jsonb_build_object('store', new.store_id, 'from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
create trigger st_guard before insert or update on public.stocktakes for each row execute function app.guard_stocktake();

grant select, insert, update, delete on public.products, public.product_stores to app_user;
grant select, insert, delete on public.stocktakes to app_user;
grant update (status) on public.stocktakes to app_user;
grant select, insert, delete on public.stocktake_lines to app_user;
grant update (quantity) on public.stocktake_lines to app_user;
