-- 指名売上（月ごと・個人ごと）。数字はずっと残す。レジ画面の写真は2か月だけ残す。
create table public.sales_stats (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  store_id       uuid not null,
  membership_id  uuid not null references public.memberships(id),
  month          date not null check (extract(day from month) = 1),         -- その月の1日
  total_sales    int not null default 0 check (total_sales between 0 and 1000000000),      -- 総合売上
  free_sales     int not null default 0 check (free_sales between 0 and 1000000000),       -- フリー売上
  nominated_sales int not null default 0 check (nominated_sales between 0 and 1000000000), -- 指名技術売上
  retail_sales   int not null default 0 check (retail_sales between 0 and 1000000000),     -- 店販売上
  customers      int not null default 0 check (customers between 0 and 100000),            -- 客数
  new_customers  int not null default 0 check (new_customers between 0 and 100000),       -- 新規
  repeat_customers int not null default 0 check (repeat_customers between 0 and 100000),   -- 再来
  source         text not null default 'manual' check (source in ('manual','photo','import')),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  unique (membership_id, month),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.sales_stats (store_id, month);

-- 目標: membership_id が空 = お店の目標、あり = 個人の目標
create table public.sales_targets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  store_id      uuid not null,
  membership_id uuid references public.memberships(id),
  month         date not null check (extract(day from month) = 1),
  target        int not null check (target between 0 and 1000000000),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create unique index sales_targets_uq on public.sales_targets (store_id, coalesce(membership_id, '00000000-0000-0000-0000-000000000000'::uuid), month);

create table public.sales_images (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id   uuid not null,
  month      date not null,
  mime       text not null check (mime in ('image/jpeg','image/png','image/webp')),
  size       int not null,
  data       bytea not null,
  created_by uuid not null references public.memberships(id),
  created_at timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);

alter table public.stores add column sales_board_public boolean not null default true;   -- 店内ランキングを、スタッフにも見せる

-- 見られる人: 本人・店長(自店)・管理者(全店)。入れられる人: 店長(自店)・管理者(全店)
create function app.sales_visible(p_store uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or p_member = m.id or (m.level = 3 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
create function app.sales_edit(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or (m.level = 3 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
grant execute on function app.sales_visible(uuid, uuid), app.sales_edit(uuid) to app_user;

alter table public.sales_stats   enable row level security;
alter table public.sales_targets enable row level security;
alter table public.sales_images  enable row level security;
create policy ss_select on public.sales_stats for select to app_user using (company_id = app.my_company_id() and app.sales_visible(store_id, membership_id));
create policy ss_insert on public.sales_stats for insert to app_user with check (company_id = app.my_company_id() and app.sales_edit(store_id)
  and exists (select 1 from public.memberships a where a.id = membership_id and a.store_id = sales_stats.store_id));
create policy ss_update on public.sales_stats for update to app_user using (company_id = app.my_company_id() and app.sales_edit(store_id)) with check (company_id = app.my_company_id() and app.sales_edit(store_id));
-- 目標は、スタッフにも見える（自分の達成率を出すため）。決められるのは店長・管理者
create policy st_select on public.sales_targets for select to app_user using (company_id = app.my_company_id() and not app.me_display_only()
  and (app.my_level() = 4 or store_id = (app.me()).store_id) and (membership_id is null or app.sales_visible(store_id, membership_id)));
create policy st_insert on public.sales_targets for insert to app_user with check (company_id = app.my_company_id() and app.sales_edit(store_id));
create policy st_update on public.sales_targets for update to app_user using (company_id = app.my_company_id() and app.sales_edit(store_id)) with check (company_id = app.my_company_id() and app.sales_edit(store_id));
create policy st_delete on public.sales_targets for delete to app_user using (company_id = app.my_company_id() and app.sales_edit(store_id));
create policy si_select on public.sales_images for select to app_user using (company_id = app.my_company_id() and app.sales_edit(store_id));
create policy si_insert on public.sales_images for insert to app_user with check (company_id = app.my_company_id() and app.sales_edit(store_id) and created_by = app.uid());
grant select, insert on public.sales_stats to app_user;
grant update (total_sales, free_sales, nominated_sales, retail_sales, customers, new_customers, repeat_customers, source, updated_by, updated_at) on public.sales_stats to app_user;
grant select, insert, delete on public.sales_targets to app_user;
grant update (target, updated_by, updated_at) on public.sales_targets to app_user;
grant select, insert on public.sales_images to app_user;
grant update (sales_board_public) on public.stores to app_user;

-- 店内ランキング（順位・名前・総合売上）。お店の設定で、スタッフにも見せられる。店長・管理者はいつでも見られる
create function public.sales_board(p_store uuid, p_month date) returns table (membership_id uuid, name text, total_sales int, customers int, rank int)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships; pub boolean;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then return; end if;
  select s.sales_board_public into pub from public.stores s where s.id = p_store and s.company_id = me.company_id;
  if pub is null then return; end if;
  if not (me.level = 4 or (me.level = 3 and me.store_id = p_store) or (me.store_id = p_store and pub)) then return; end if;
  return query
    select x.membership_id, m.name, x.total_sales, x.customers, (rank() over (order by x.total_sales desc))::int
      from public.sales_stats x join public.memberships m on m.id = x.membership_id
     where x.store_id = p_store and x.month = p_month and x.total_sales > 0 and m.status = 'active'
     order by x.total_sales desc, m.name;
end $$;
grant execute on function public.sales_board(uuid, date) to app_user;

-- 店の合計（スタッフにも見せる: 「お店の売上のうち、自分は何%か」を出すため）
create function public.sales_store_total(p_store uuid, p_month date) returns table (total_sales int, customers int)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then return; end if;
  if not (me.level = 4 or me.store_id = p_store) then return; end if;
  return query select coalesce(sum(x.total_sales), 0)::int, coalesce(sum(x.customers), 0)::int from public.sales_stats x where x.store_id = p_store and x.month = p_month and x.company_id = me.company_id;
end $$;
grant execute on function public.sales_store_total(uuid, date) to app_user;
