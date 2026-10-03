-- 売上の流れ: 本人が記入して提出 → 店長が確認 → 事務員さんが確定。差し戻しもできる。
alter table public.sales_stats
  add column status text not null default 'draft' check (status in ('draft','submitted','manager_ok','office_ok','returned')),
  add column submitted_at timestamptz,
  add column manager_id uuid, add column manager_at timestamptz,
  add column office_id uuid,  add column office_at timestamptz,
  add column return_comment text,
  add column returned_by uuid;
grant update (status, submitted_at, manager_id, manager_at, office_id, office_at, return_comment, returned_by) on public.sales_stats to app_user;

-- 確定した数字は、店長・管理者でも直接は直せない（差し戻してから直す）
drop policy ss_update on public.sales_stats;
create policy ss_update on public.sales_stats for update to app_user
  using (company_id = app.my_company_id() and app.sales_edit(store_id) and status <> 'office_ok')
  with check (company_id = app.my_company_id() and app.sales_edit(store_id));

-- 本人の記入（下書き・差し戻しのときだけ）
create function public.sales_save_own(p_month date, p_total int, p_free int, p_nom int, p_retail int, p_cust int, p_new int, p_rep int) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.sales_stats;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level >= 4 then raise exception 'forbidden'; end if;
  if extract(day from p_month) <> 1 then raise exception 'bad month'; end if;
  if least(p_total, p_free, p_nom, p_retail, p_cust, p_new, p_rep) < 0 or greatest(p_total, p_free, p_nom, p_retail) > 1000000000 or greatest(p_cust, p_new, p_rep) > 100000 then raise exception 'bad value'; end if;
  select * into cur from public.sales_stats where membership_id = me.id and month = p_month;
  if cur.id is not null and cur.status not in ('draft','returned') then raise exception 'locked'; end if;
  if cur.id is null then
    insert into public.sales_stats (company_id, store_id, membership_id, month, total_sales, free_sales, nominated_sales, retail_sales, customers, new_customers, repeat_customers, source, updated_by, status)
      values (me.company_id, me.store_id, me.id, p_month, p_total, p_free, p_nom, p_retail, p_cust, p_new, p_rep, 'manual', me.id, 'draft');
    return 'draft';
  end if;
  update public.sales_stats set total_sales = p_total, free_sales = p_free, nominated_sales = p_nom, retail_sales = p_retail, customers = p_cust, new_customers = p_new, repeat_customers = p_rep,
         source = 'manual', updated_by = me.id, updated_at = now() where id = cur.id;
  return cur.status;
end $$;

-- 提出（店長の分は、店長の確認をとばして、事務員さんの確認から）
create function public.sales_submit(p_month date) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.sales_stats; ns text;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level >= 4 then raise exception 'forbidden'; end if;
  select * into cur from public.sales_stats where membership_id = me.id and month = p_month;
  if cur.id is null then raise exception 'no data'; end if;
  if cur.status not in ('draft','returned') then raise exception 'locked'; end if;
  ns := case when me.level >= 3 then 'manager_ok' else 'submitted' end;
  update public.sales_stats set status = ns, submitted_at = now(), return_comment = null,
         manager_id = case when ns = 'manager_ok' then me.id end, manager_at = case when ns = 'manager_ok' then now() end where id = cur.id;
  return ns;
end $$;

-- 確認・確定・差し戻し
--   manager_ok: 店長(自店)・管理者 … 「提出済み」を確認する（店長に代わって管理者が確認してもよい）
--   office_ok : 管理者(事務員さん) … 「店長確認済み」を確定する
--   return    : 店長(自店・提出済みのみ)・管理者(確定済みも) … 本人に差し戻す
create function public.sales_review(p_member uuid, p_month date, p_action text, p_comment text) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.sales_stats;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into cur from public.sales_stats where membership_id = p_member and month = p_month and company_id = me.company_id;
  if cur.id is null then raise exception 'not found'; end if;
  if cur.membership_id = me.id then raise exception 'own'; end if;
  if not (me.level = 4 or (me.level = 3 and me.store_id = cur.store_id)) then raise exception 'forbidden'; end if;
  if p_action = 'manager_ok' then
    if cur.status <> 'submitted' then raise exception 'wrong status'; end if;
    update public.sales_stats set status = 'manager_ok', manager_id = me.id, manager_at = now() where id = cur.id;
    return 'manager_ok';
  elsif p_action = 'office_ok' then
    if me.level <> 4 then raise exception 'forbidden'; end if;
    if cur.status <> 'manager_ok' then raise exception 'wrong status'; end if;
    update public.sales_stats set status = 'office_ok', office_id = me.id, office_at = now() where id = cur.id;
    return 'office_ok';
  elsif p_action = 'return' then
    if cur.status = 'office_ok' and me.level <> 4 then raise exception 'forbidden'; end if;
    if cur.status in ('draft','returned') then raise exception 'wrong status'; end if;
    update public.sales_stats set status = 'returned', return_comment = left(coalesce(p_comment, ''), 300), returned_by = me.id, manager_id = null, manager_at = null, office_id = null, office_at = null where id = cur.id;
    return 'returned';
  end if;
  raise exception 'bad action';
end $$;
revoke all on function public.sales_save_own(date,int,int,int,int,int,int,int), public.sales_submit(date), public.sales_review(uuid,date,text,text) from public;
grant execute on function public.sales_save_own(date,int,int,int,int,int,int,int), public.sales_submit(date), public.sales_review(uuid,date,text,text) to app_user;

-- ランキング・お店の合計には、「下書き・差し戻し」の数字を入れない（提出されたものから数える）
create or replace function public.sales_board(p_store uuid, p_month date) returns table (membership_id uuid, name text, total_sales int, customers int, rank int)
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
     where x.store_id = p_store and x.month = p_month and x.total_sales > 0 and m.status = 'active' and x.status in ('submitted','manager_ok','office_ok')
     order by x.total_sales desc, m.name;
end $$;
create or replace function public.sales_store_total(p_store uuid, p_month date) returns table (total_sales int, customers int)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then return; end if;
  if not (me.level = 4 or me.store_id = p_store) then return; end if;
  return query select coalesce(sum(x.total_sales), 0)::int, coalesce(sum(x.customers), 0)::int from public.sales_stats x
    where x.store_id = p_store and x.month = p_month and x.company_id = me.company_id and x.status in ('submitted','manager_ok','office_ok');
end $$;
