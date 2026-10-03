-- Phase 7: 在庫管理（材料・商品）。商品マスターは棚卸しと共通。使う機能はお店ごとに選べる

insert into public.level_permissions (level, permission, scope) values
  (2, 'stock.view', 'own'), (3, 'stock.view', 'all'), (4, 'stock.view', 'all'),   -- 在庫を見る
  (2, 'stock.edit', 'own'), (3, 'stock.edit', 'own'), (4, 'stock.edit', 'all'),   -- 入庫・出庫・数え直しを記録する
  (3, 'stock.settings', 'own'), (4, 'stock.settings', 'all');                     -- お店の使う機能・発注点を決める

-- お店ごとの「使う機能」。行が無いお店は、すべて使う（初期値）
create table public.store_stock_settings (
  store_id      uuid primary key,
  company_id    uuid not null,
  use_movements boolean not null default true,   -- 入庫・出庫の記録
  use_recount   boolean not null default true,   -- 数え直し（数えた数を入れ直す）
  use_reorder   boolean not null default true,   -- 発注の目安（残りが少ない商品）
  track_retail  boolean not null default true,   -- 店販を管理する
  track_supply  boolean not null default true,   -- 業務（材料）を管理する
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  foreign key (store_id, company_id) references public.stores (id, company_id)
);

create function app.stock_feature(p_store uuid, f text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case f when 'movements' then use_movements when 'recount' then use_recount when 'reorder' then use_reorder
                                 when 'retail' then track_retail when 'supply' then track_supply end
                     from public.store_stock_settings where store_id = p_store), true)
$$;

-- いまの在庫（お店×商品）。数量は入庫・出庫の記録からだけ変わる
create table public.stock_levels (
  store_id        uuid not null,
  product_id      uuid not null,
  company_id      uuid not null,
  quantity        int  not null default 0 check (quantity >= 0),
  min_quantity    int  check (min_quantity >= 0),      -- 発注点（これ以下になったら「少ない」）
  target_quantity int  check (target_quantity >= 0),   -- 補充の目標（発注の目安の数に使う）
  updated_at      timestamptz not null default now(),
  primary key (store_id, product_id),
  foreign key (store_id, company_id)   references public.stores (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id)
);

-- 入庫・出庫・数え直しの履歴（追記のみ。消す・直すはできない。まちがえたら逆の記録を足す）
create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  store_id       uuid not null,
  product_id     uuid not null,
  kind           text not null check (kind in ('in','out','recount')),
  delta          int  not null check (delta <> 0),
  quantity_after int,
  name           text,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  foreign key (store_id, company_id)   references public.stores (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id),
  check ((kind = 'in' and delta > 0) or (kind = 'out' and delta < 0) or kind = 'recount')
);
create index on public.stock_movements (store_id, product_id, created_at desc);

-- その商品は、そのお店で管理する対象か（店販/業務の選択・使うお店）
create function app.stock_tracked(p_store uuid, p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.products p join public.product_stores ps on ps.product_id = p.id
                  where p.id = p_product and ps.store_id = p_store and app.stock_feature(p_store, p.kind))
$$;

alter table public.store_stock_settings enable row level security;
alter table public.stock_levels         enable row level security;
alter table public.stock_movements      enable row level security;

create policy sss_select on public.store_stock_settings for select to app_user
  using (company_id = app.my_company_id() and app.has_perm('stock.view', store_id));
create policy sss_insert on public.store_stock_settings for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('stock.settings', store_id));
create policy sss_update on public.store_stock_settings for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('stock.settings', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('stock.settings', store_id));

create policy sl_stock_select on public.stock_levels for select to app_user
  using (company_id = app.my_company_id() and app.has_perm('stock.view', store_id));
create policy sl_stock_insert on public.stock_levels for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('stock.settings', store_id) and quantity = 0);
create policy sl_stock_update on public.stock_levels for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('stock.settings', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('stock.settings', store_id));

create policy sm_select on public.stock_movements for select to app_user
  using (company_id = app.my_company_id() and app.has_perm('stock.view', store_id));
create policy sm_insert on public.stock_movements for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('stock.edit', store_id) and app.stock_tracked(store_id, product_id)
              and ((kind in ('in','out') and app.stock_feature(store_id, 'movements')) or (kind = 'recount' and app.stock_feature(store_id, 'recount'))));

-- 記録を足すと、在庫の数量を自動で変える（在庫がマイナスになる出庫はできない）
create function app.apply_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur int; nxt int;
begin
  insert into public.stock_levels (store_id, product_id, company_id) values (new.store_id, new.product_id, new.company_id) on conflict do nothing;
  select quantity into cur from public.stock_levels where store_id = new.store_id and product_id = new.product_id for update;
  nxt := cur + new.delta;
  if nxt < 0 then raise exception 'not enough stock (have %)', cur; end if;
  update public.stock_levels set quantity = nxt, updated_at = now() where store_id = new.store_id and product_id = new.product_id;
  new.quantity_after := nxt;
  new.created_by := app.uid();
  new.name := (select p.name from public.products p where p.id = new.product_id);
  return new;
end $$;
create trigger sm_apply before insert on public.stock_movements for each row execute function app.apply_movement();

grant select, insert on public.store_stock_settings to app_user;
grant update (use_movements, use_recount, use_reorder, track_retail, track_supply, updated_at, updated_by) on public.store_stock_settings to app_user;
grant select, insert on public.stock_levels to app_user;
grant update (min_quantity, target_quantity) on public.stock_levels to app_user;
grant select, insert on public.stock_movements to app_user;
