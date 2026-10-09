-- 数量以外は変えられない決まりに、「この関数からの1行編集」だけ例外を作る
create or replace function app.guard_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and app.uid() is not null and coalesce(current_setting('app.line_edit', true), '') <> '1'
     and (new.cost_price <> old.cost_price or new.name <> old.name or new.maker <> old.maker or new.spec <> old.spec) then
    raise exception 'only quantity can be changed';
  end if;
  return new;
end $$;

-- 棚卸しの1行（メーカー・品名・規格・仕入値）を、その表の中だけで直せる（入力中の表だけ。商品マスターは変えない）
create function public.stocktake_line_edit(p_line uuid, p_maker text, p_name text, p_spec text, p_cost int) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.stocktake_lines; me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into l from public.stocktake_lines where id = p_line and company_id = me.company_id;
  if l.id is null then raise exception 'forbidden'; end if;
  if not (app.stocktake_editable(l.stocktake_id, l.store_id) and app.has_perm('stocktake.edit', l.store_id)) then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_name, '')) = '' or p_cost < 0 or p_cost > 99999999 then raise exception 'bad item'; end if;
  perform set_config('app.line_edit', '1', true);
  update public.stocktake_lines set maker = left(btrim(coalesce(p_maker, '')), 80), name = left(btrim(p_name), 120), spec = left(btrim(coalesce(p_spec, '')), 60), cost_price = p_cost where id = p_line;
  perform set_config('app.line_edit', '', true);
  return true;
end $$;
revoke all on function public.stocktake_line_edit(uuid, text, text, text, int) from public;
grant execute on function public.stocktake_line_edit(uuid, text, text, text, int) to app_user;
