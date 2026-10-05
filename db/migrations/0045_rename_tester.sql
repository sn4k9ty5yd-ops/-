-- 在庫の履歴に出る言葉を、「テスター」から「業務に回した分」に変える
create or replace function public.tester_add(p_store uuid, p_product uuid, p_qty int, p_day date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; pr public.products; sid uuid; applied boolean;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  if not (me.level = 4 or me.store_id = p_store) then raise exception 'forbidden'; end if;
  select * into pr from public.products where id = p_product and company_id = me.company_id and kind = 'retail';
  if pr.id is null then raise exception 'not found'; end if;
  if not exists (select 1 from public.stores where id = p_store and company_id = me.company_id) then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10000 then raise exception 'bad qty'; end if;
  applied := app.stock_take_out(p_store, p_product, p_qty, '業務に回した分', me.id);
  insert into public.tester_log (company_id, store_id, product_id, maker, product_name, spec, qty, unit_cost, amount, day, note, stock_applied, created_by)
  values (me.company_id, p_store, pr.id, pr.maker, pr.name, pr.spec, p_qty, pr.cost_price, pr.cost_price * p_qty, coalesce(p_day, current_date), nullif(trim(coalesce(p_note, '')), ''), applied, me.id)
  returning id into sid;
  return sid;
end $$;

create or replace function public.stock_entry_cancel(p_kind text, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me public.memberships; t public.tester_log; s public.staff_purchases;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  if p_kind = 'tester' then
    select * into t from public.tester_log where id = p_id and company_id = me.company_id and cancelled_at is null;
    if t.id is null then raise exception 'not found'; end if;
    if not (me.level = 4 or t.created_by = me.id or (me.level = 3 and me.store_id = t.store_id)) then raise exception 'forbidden'; end if;
    update public.tester_log set cancelled_at = now(), cancelled_by = me.id where id = t.id;
    if t.stock_applied then perform app.stock_put_back(t.store_id, t.product_id, t.qty, '業務に回した分の取り消し', me.id); end if;
  elsif p_kind = 'purchase' then
    select * into s from public.staff_purchases where id = p_id and company_id = me.company_id and cancelled_at is null;
    if s.id is null then raise exception 'not found'; end if;
    if not (me.level = 4 or s.created_by = me.id or (me.level = 3 and me.store_id = s.store_id)) then raise exception 'forbidden'; end if;
    update public.staff_purchases set cancelled_at = now(), cancelled_by = me.id where id = s.id;
    if s.stock_applied then perform app.stock_put_back(s.store_id, s.product_id, s.qty, 'スタッフ購入の取り消し', me.id); end if;
  else raise exception 'bad kind'; end if;
  return true;
end $$;
