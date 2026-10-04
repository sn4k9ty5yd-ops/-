-- 売上: 着付け・メイク・ヘッドスパの人数と売上、歩合（店販10%・着付け25%・メイク20%・ヘッドスパ20%）、提出期限と督促
alter table public.sales_stats
  add column retail_count int not null default 0 check (retail_count between 0 and 100000),
  add column kitsuke_count int not null default 0 check (kitsuke_count between 0 and 100000),
  add column kitsuke_sales int not null default 0 check (kitsuke_sales between 0 and 1000000000),
  add column makeup_count int not null default 0 check (makeup_count between 0 and 100000),
  add column makeup_sales int not null default 0 check (makeup_sales between 0 and 1000000000),
  add column spa_count int not null default 0 check (spa_count between 0 and 100000),
  add column spa_sales int not null default 0 check (spa_sales between 0 and 1000000000),
  add column commission_amount int check (commission_amount is null or commission_amount between 0 and 1000000000),   -- 歩合（店長・シフト担当がつける）
  add column commission_by uuid, add column commission_at timestamptz;
grant update (retail_count, kitsuke_count, kitsuke_sales, makeup_count, makeup_sales, spa_count, spa_sales) on public.sales_stats to app_user;

-- 歩合の割合（会社ごと。管理者が変えられる）
create table public.sales_rates (
  company_id uuid not null references public.companies(id),
  item       text not null check (item in ('retail','kitsuke','makeup','spa')),
  percent    numeric(5,2) not null check (percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (company_id, item)
);
alter table public.sales_rates enable row level security;
create policy sr_select on public.sales_rates for select to app_user using (company_id = app.my_company_id());
create policy sr_write on public.sales_rates for all to app_user using (company_id = app.my_company_id() and app.my_level() = 4) with check (company_id = app.my_company_id() and app.my_level() = 4);
grant select, insert, update on public.sales_rates to app_user;
insert into public.sales_rates (company_id, item, percent) select c.id, r.item, r.p from public.companies c cross join (values ('retail', 10), ('kitsuke', 25), ('makeup', 20), ('spa', 20)) as r(item, p);

-- 提出期限（お店×月）。決めていなければ「月末」
create table public.sales_deadlines (
  store_id   uuid not null,
  company_id uuid not null,
  month      date not null check (extract(day from month) = 1),
  due_on     date not null,
  updated_by uuid,
  primary key (store_id, month),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
alter table public.sales_deadlines enable row level security;
create policy sd_select on public.sales_deadlines for select to app_user using (company_id = app.my_company_id() and (app.my_level() = 4 or store_id = (app.me()).store_id));
create policy sd_insert on public.sales_deadlines for insert to app_user with check (company_id = app.my_company_id() and app.sales_edit(store_id));
create policy sd_update on public.sales_deadlines for update to app_user using (company_id = app.my_company_id() and app.sales_edit(store_id)) with check (company_id = app.my_company_id() and app.sales_edit(store_id));
create policy sd_delete on public.sales_deadlines for delete to app_user using (company_id = app.my_company_id() and app.sales_edit(store_id));
grant select, insert, update, delete on public.sales_deadlines to app_user;
create table public.sales_reminder_log (
  store_id uuid not null, month date not null, kind text not null, sent_on date not null default current_date,
  primary key (store_id, month, kind)
);

-- シフト担当(Lv2)も、自店の売上を見て、歩合をつけられる（数字の直しと確認はできない）
create or replace function app.sales_visible(p_store uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or p_member = m.id or (m.level >= 2 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
create function app.sales_commission_edit(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or (m.level >= 2 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
grant execute on function app.sales_commission_edit(uuid) to app_user;

create function public.sales_set_commission(p_member uuid, p_month date, p_amount int) returns boolean
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.sales_stats;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into cur from public.sales_stats where membership_id = p_member and month = p_month and company_id = me.company_id;
  if cur.id is null then raise exception 'not found'; end if;
  if not app.sales_commission_edit(cur.store_id) then raise exception 'forbidden'; end if;
  if cur.membership_id = me.id then raise exception 'own'; end if;
  if cur.status in ('draft','returned') then raise exception 'not submitted'; end if;
  if cur.status = 'office_ok' then raise exception 'locked'; end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 1000000000) then raise exception 'bad value'; end if;
  update public.sales_stats set commission_amount = p_amount, commission_by = case when p_amount is null then null else me.id end, commission_at = case when p_amount is null then null else now() end where id = cur.id;
  return true;
end $$;
revoke all on function public.sales_set_commission(uuid, date, int) from public;
grant execute on function public.sales_set_commission(uuid, date, int) to app_user;

-- 本人の記入: 項目がふえたので、数字を1つのまとまり(jsonb)で受け取る
drop function public.sales_save_own(date,int,int,int,int,int,int,int);
create function public.sales_save_own(p_month date, p_v jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.sales_stats;
  t int := coalesce((p_v->>'total')::int, 0);  f int := coalesce((p_v->>'free')::int, 0);  n int := coalesce((p_v->>'nominated')::int, 0);
  r int := coalesce((p_v->>'retail')::int, 0); rc int := coalesce((p_v->>'retailCount')::int, 0);
  c int := coalesce((p_v->>'customers')::int, 0); nc int := coalesce((p_v->>'newCustomers')::int, 0); rp int := coalesce((p_v->>'repeatCustomers')::int, 0);
  kc int := coalesce((p_v->>'kitsukeCount')::int, 0); ks int := coalesce((p_v->>'kitsukeSales')::int, 0);
  mc int := coalesce((p_v->>'makeupCount')::int, 0); ms int := coalesce((p_v->>'makeupSales')::int, 0);
  sc int := coalesce((p_v->>'spaCount')::int, 0); ss int := coalesce((p_v->>'spaSales')::int, 0);
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level >= 4 then raise exception 'forbidden'; end if;
  if extract(day from p_month) <> 1 then raise exception 'bad month'; end if;
  if least(t, f, n, r, rc, c, nc, rp, kc, ks, mc, ms, sc, ss) < 0 or greatest(t, f, n, r, ks, ms, ss) > 1000000000 or greatest(rc, c, nc, rp, kc, mc, sc) > 100000 then raise exception 'bad value'; end if;
  select * into cur from public.sales_stats where membership_id = me.id and month = p_month;
  if cur.id is not null and cur.status not in ('draft','returned') then raise exception 'locked'; end if;
  if cur.id is null then
    insert into public.sales_stats (company_id, store_id, membership_id, month, total_sales, free_sales, nominated_sales, retail_sales, retail_count, customers, new_customers, repeat_customers,
        kitsuke_count, kitsuke_sales, makeup_count, makeup_sales, spa_count, spa_sales, source, updated_by, status)
      values (me.company_id, me.store_id, me.id, p_month, t, f, n, r, rc, c, nc, rp, kc, ks, mc, ms, sc, ss, 'manual', me.id, 'draft');
    return 'draft';
  end if;
  update public.sales_stats set total_sales = t, free_sales = f, nominated_sales = n, retail_sales = r, retail_count = rc, customers = c, new_customers = nc, repeat_customers = rp,
         kitsuke_count = kc, kitsuke_sales = ks, makeup_count = mc, makeup_sales = ms, spa_count = sc, spa_sales = ss, source = 'manual', updated_by = me.id, updated_at = now() where id = cur.id;
  return cur.status;
end $$;
revoke all on function public.sales_save_own(date, jsonb) from public;
grant execute on function public.sales_save_own(date, jsonb) to app_user;
