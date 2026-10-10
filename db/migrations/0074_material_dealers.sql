-- 材料費: 業者（ディーラー）とカテゴリーを、選んで入れられるようにする（お店ごと・店長以上が編集・使ったものは自動で覚える）
create table public.material_dealers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id   uuid not null,
  name       text not null check (length(trim(name)) between 1 and 80),
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id),
  unique (store_id, name)
);
-- カテゴリー（カラー・ストレートなど）。dealer_id があれば、その業者の下。無ければ、どの業者でも使える
create table public.material_categories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id   uuid not null,
  dealer_id  uuid references public.material_dealers(id),
  name       text not null check (length(trim(name)) between 1 and 40),
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create unique index material_categories_uq on public.material_categories (store_id, coalesce(dealer_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

alter table public.material_orders add column category text not null default '';
grant update (category) on public.material_orders to app_user;

-- 編集（名前を変える・しまう・並べる）ができる人: 店長(自店)・正美さんたち(全店)・その店の材料担当
create function app.material_dealer_edit(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.has_perm('material.budget', p_store) or app.is_material_mgr_in(p_store), false)
$$;
grant execute on function app.material_dealer_edit(uuid) to app_user;

alter table public.material_dealers enable row level security;
alter table public.material_categories enable row level security;
create policy md_select on public.material_dealers for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.view', store_id) or app.is_material_mgr_in(store_id)));
-- 使った業者は、書き込める人なら自動で覚える（追加）。名前の変更・しまうは店長以上
create policy md_insert on public.material_dealers for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.edit', store_id) or app.is_material_mgr_in(store_id)));
create policy md_update on public.material_dealers for update to app_user
  using (company_id = app.my_company_id() and app.material_dealer_edit(store_id))
  with check (company_id = app.my_company_id() and app.material_dealer_edit(store_id));
create policy mc_select on public.material_categories for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.view', store_id) or app.is_material_mgr_in(store_id)));
create policy mc_insert on public.material_categories for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.edit', store_id) or app.is_material_mgr_in(store_id)));
create policy mc_update on public.material_categories for update to app_user
  using (company_id = app.my_company_id() and app.material_dealer_edit(store_id))
  with check (company_id = app.my_company_id() and app.material_dealer_edit(store_id));
grant select, insert on public.material_dealers, public.material_categories to app_user;
grant update (name, sort_order, active) on public.material_dealers to app_user;
grant update (name, sort_order, active, dealer_id) on public.material_categories to app_user;

-- 今までに入れた発注先を、業者として覚えておく（よく使う順）
insert into public.material_dealers (company_id, store_id, name, sort_order)
select company_id, store_id, supplier, (row_number() over (partition by store_id order by count(*) desc, max(created_at) desc))::int
  from public.material_orders where trim(supplier) <> '' and deleted_at is null
 group by company_id, store_id, supplier
on conflict (store_id, name) do nothing;
