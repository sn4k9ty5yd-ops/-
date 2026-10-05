-- 売上: スタッフ(Lv1)・シフト担当(Lv2)は、自分の分だけ。店長は自分の店。事務員さん(Lv4)は全店。歩合をつけるのも店長以上
create or replace function app.sales_visible(p_store uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or p_member = m.id or (m.level = 3 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
create or replace function app.sales_commission_edit(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or (m.level = 3 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
create or replace function public.sales_board(p_store uuid, p_month date) returns table (membership_id uuid, name text, total_sales int, customers int, rank int)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then return; end if;
  if not (me.level = 4 or (me.level = 3 and me.store_id = p_store)) then return; end if;
  return query
    select x.membership_id, m.name, x.total_sales, x.customers, (rank() over (order by x.total_sales desc))::int
      from public.sales_stats x join public.memberships m on m.id = x.membership_id
     where x.store_id = p_store and x.month = p_month and x.total_sales > 0 and m.status = 'active' and x.company_id = me.company_id and x.status in ('submitted','manager_ok','office_ok')
     order by x.total_sales desc, m.name;
end $$;
create or replace function public.sales_store_total(p_store uuid, p_month date) returns table (total_sales int, customers int)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then return; end if;
  if not (me.level = 4 or (me.level = 3 and me.store_id = p_store)) then return; end if;
  return query select coalesce(sum(x.total_sales), 0)::int, coalesce(sum(x.customers), 0)::int from public.sales_stats x where x.store_id = p_store and x.month = p_month and x.company_id = me.company_id and x.status in ('submitted','manager_ok','office_ok');
end $$;
