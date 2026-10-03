-- 材料費（発注した額）の管理。同じお店の人は、見られて、書き込める。店長以上は、他のお店も見られる（見るだけ）。
-- 消さずに「取り消し」にして、変更・取り消しはすべて記録に残す（あとから追える）。
insert into public.level_permissions (level, permission, scope) values
  (1, 'material.view', 'own'), (2, 'material.view', 'own'), (3, 'material.view', 'all'), (4, 'material.view', 'all'),
  (1, 'material.edit', 'own'), (2, 'material.edit', 'own'), (3, 'material.edit', 'own'), (4, 'material.edit', 'all'),
  (3, 'material.budget', 'own'), (4, 'material.budget', 'all');

create table public.material_orders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  store_id    uuid not null,
  ordered_on  date not null,
  supplier    text not null default '',                 -- 発注先（業者）
  item        text not null default '',                 -- 内容（何を発注したか）
  kind        text not null default 'supply' check (kind in ('supply','retail','other')),   -- 材料(業務)／店販／その他
  amount      int  not null check (amount >= 0 and amount <= 100000000),                    -- 金額（税抜・円）
  note        text not null default '',
  lines       jsonb not null default '[]',               -- 明細（商品名・数量・金額。スクリーンショットから読み取った分）
  created_by  uuid not null references public.memberships(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz,
  deleted_at  timestamptz,
  deleted_by  uuid,
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.material_orders (store_id, ordered_on);

create table public.material_budgets (
  store_id   uuid not null,
  company_id uuid not null,
  month      date not null check (extract(day from month) = 1),    -- その月の1日
  amount     int  not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (store_id, month),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);

create table public.material_order_log (
  id         bigint generated always as identity primary key,
  order_id   uuid not null,
  company_id uuid not null,
  store_id   uuid not null,
  user_id    uuid,
  action     text not null,                 -- 追加／変更／取り消し
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index on public.material_order_log (order_id, at);

-- 発注画面のスクリーンショット。貼った人と日時は自動で記録される（あとから消せない）。
create table public.material_order_images (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.material_orders(id),
  company_id uuid not null,
  store_id   uuid not null,
  mime       text not null check (mime in ('image/jpeg','image/png','image/webp')),
  size       int  not null,
  data       bytea not null,
  created_by uuid not null references public.memberships(id),
  created_at timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.material_order_images (order_id);
alter table public.material_order_images enable row level security;
create policy moi_select on public.material_order_images for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and app.has_perm('material.view', store_id));
create policy moi_insert on public.material_order_images for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only() and app.has_perm('material.edit', store_id) and created_by = app.uid());
grant select, insert on public.material_order_images to app_user;

alter table public.material_orders    enable row level security;
alter table public.material_budgets   enable row level security;
alter table public.material_order_log enable row level security;

create policy mo_select on public.material_orders for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and app.has_perm('material.view', store_id)
         and (deleted_at is null or app.my_level() >= 3));
create policy mo_insert on public.material_orders for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only() and app.has_perm('material.edit', store_id) and created_by = app.uid());
create policy mo_update on public.material_orders for update to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and app.has_perm('material.edit', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('material.edit', store_id));
create policy mb_select on public.material_budgets for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and app.has_perm('material.view', store_id));
create policy mb_write on public.material_budgets for all to app_user
  using (company_id = app.my_company_id() and app.has_perm('material.budget', store_id))
  with check (company_id = app.my_company_id() and app.has_perm('material.budget', store_id));
create policy mol_select on public.material_order_log for select to app_user
  using (company_id = app.my_company_id() and app.my_level() >= 3 and app.has_perm('material.view', store_id));

grant select, insert on public.material_orders to app_user;
grant update (ordered_on, supplier, item, kind, amount, note, lines, deleted_at, deleted_by, updated_at, updated_by) on public.material_orders to app_user;
grant select, insert, update, delete on public.material_budgets to app_user;
grant select on public.material_order_log to app_user;

-- 記録（追加・変更・取り消し）。ログイン中の人が、自分では消せない。
create function app.material_order_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.material_order_log (order_id, company_id, store_id, user_id, action, after)
      values (new.id, new.company_id, new.store_id, app.uid(), '追加', to_jsonb(new));
  else
    insert into public.material_order_log (order_id, company_id, store_id, user_id, action, before, after)
      values (new.id, new.company_id, new.store_id, app.uid(), case when new.deleted_at is not null and old.deleted_at is null then '取り消し' else '変更' end, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
create trigger material_orders_log after insert or update on public.material_orders for each row execute function app.material_order_log();

-- 取り消し（見えなくなる更新なので、権限の確認つきの関数で行う）
create function public.material_cancel(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare o public.material_orders;
begin
  select * into o from public.material_orders where id = p_id and deleted_at is null;
  if not found or o.company_id <> app.my_company_id() or app.me_display_only() or not app.has_perm('material.edit', o.store_id) then return false; end if;
  update public.material_orders set deleted_at = now(), deleted_by = app.uid(), updated_at = now(), updated_by = app.uid() where id = p_id;
  return true;
end $$;
revoke all on function public.material_cancel(uuid) from public;
grant execute on function public.material_cancel(uuid) to app_user;
