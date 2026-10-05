-- 在庫: スタッフ全員が見られる（自店だけ。店長も自店だけ。事務員さんは全店）
insert into public.level_permissions (level, permission, scope) values
  (1, 'stock.view', 'own'), (3, 'stock.view', 'own')
on conflict (level, permission) do update set scope = excluded.scope;

-- 店販として仕入れた商品を、テスターとして業務に回した分の記録（事務所に報告する）
create table public.tester_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  store_id     uuid not null,
  product_id   uuid not null,
  maker        text not null default '',
  product_name text not null,
  spec         text not null default '',
  qty          int  not null check (qty between 1 and 10000),
  unit_cost    int  not null check (unit_cost >= 0),     -- そのときの仕入値（税抜）
  amount       int  not null check (amount >= 0),        -- 仕入値 × 本数
  day          date not null,
  note         text,
  stock_applied boolean not null default false,          -- 在庫も減らしたか
  created_by   uuid,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  foreign key (store_id, company_id) references public.stores (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index on public.tester_log (store_id, day);

-- スタッフが個人で買った分（仕入値で買う。給料から天引きするための記録）
create table public.staff_purchases (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  store_id      uuid not null,
  membership_id uuid not null,                           -- 買った人
  buyer_name    text not null,
  product_id    uuid not null,
  maker         text not null default '',
  product_name  text not null,
  spec          text not null default '',
  qty           int  not null check (qty between 1 and 10000),
  unit_price    int  not null check (unit_price >= 0),   -- スタッフ価格（仕入値）
  amount        int  not null check (amount >= 0),
  day           date not null,
  note          text,
  stock_applied boolean not null default false,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  foreign key (store_id, company_id) references public.stores (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index on public.staff_purchases (store_id, day);
create index on public.staff_purchases (membership_id, day);

alter table public.tester_log      enable row level security;
alter table public.staff_purchases enable row level security;

-- テスター: 自店の人（スタッフ全員）と事務員さん(全店)。他店は見えない
create policy tl_select on public.tester_log for select to app_user
  using (company_id = app.my_company_id() and exists (select 1 from app.me() m where not m.display_only and (m.level = 4 or m.store_id = tester_log.store_id)));
-- スタッフ購入: 本人・店長(自店)・事務員さん(全店)だけ（給料の話なので、ほかのスタッフには見せない）
create policy sp_select on public.staff_purchases for select to app_user
  using (company_id = app.my_company_id() and exists (select 1 from app.me() m where not m.display_only and (m.level = 4 or m.id = staff_purchases.membership_id or (m.level = 3 and m.store_id = staff_purchases.store_id))));
grant select on public.tester_log, public.staff_purchases to app_user;

-- 在庫を減らす（そのお店で管理している商品で、在庫が足りるときだけ）。減らしたら true
create function app.stock_take_out(p_store uuid, p_product uuid, p_qty int, p_note text, p_by uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur int; co uuid;
begin
  if not app.stock_tracked(p_store, p_product) then return false; end if;
  select quantity, company_id into cur, co from public.stock_levels where store_id = p_store and product_id = p_product;
  if cur is null or cur < p_qty then return false; end if;
  insert into public.stock_movements (company_id, store_id, product_id, kind, delta, note, created_by) values (co, p_store, p_product, 'out', -p_qty, p_note, p_by);
  return true;
end $$;
create function app.stock_put_back(p_store uuid, p_product uuid, p_qty int, p_note text, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid;
begin
  select company_id into co from public.stock_levels where store_id = p_store and product_id = p_product;
  if co is null then return; end if;
  insert into public.stock_movements (company_id, store_id, product_id, kind, delta, note, created_by) values (co, p_store, p_product, 'in', p_qty, p_note, p_by);
end $$;

-- テスターに使った（業務に回した）記録
create function public.tester_add(p_store uuid, p_product uuid, p_qty int, p_day date, p_note text) returns uuid
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
  applied := app.stock_take_out(p_store, p_product, p_qty, 'テスターに使った', me.id);
  insert into public.tester_log (company_id, store_id, product_id, maker, product_name, spec, qty, unit_cost, amount, day, note, stock_applied, created_by)
  values (me.company_id, p_store, pr.id, pr.maker, pr.name, pr.spec, p_qty, pr.cost_price, pr.cost_price * p_qty, coalesce(p_day, current_date), nullif(trim(coalesce(p_note, '')), ''), applied, me.id)
  returning id into sid;
  return sid;
end $$;

-- スタッフが個人で買った記録（本人・店長(自店)・事務員さんが入れられる）
create function public.staff_purchase_add(p_member uuid, p_product uuid, p_qty int, p_day date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; buyer public.memberships; pr public.products; sid uuid; applied boolean;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into buyer from public.memberships where id = p_member and company_id = me.company_id and status = 'active' and not display_only;
  if buyer.id is null then raise exception 'not found'; end if;
  if not (me.id = buyer.id or me.level = 4 or (me.level = 3 and me.store_id = buyer.store_id)) then raise exception 'forbidden'; end if;
  select * into pr from public.products where id = p_product and company_id = me.company_id and kind = 'retail' and status = 'active';
  if pr.id is null then raise exception 'not found'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10000 then raise exception 'bad qty'; end if;
  applied := app.stock_take_out(buyer.store_id, p_product, p_qty, 'スタッフ購入（' || buyer.name || '）', me.id);
  insert into public.staff_purchases (company_id, store_id, membership_id, buyer_name, product_id, maker, product_name, spec, qty, unit_price, amount, day, note, stock_applied, created_by)
  values (me.company_id, buyer.store_id, buyer.id, buyer.name, pr.id, pr.maker, pr.name, pr.spec, p_qty, pr.cost_price, pr.cost_price * p_qty, coalesce(p_day, current_date), nullif(trim(coalesce(p_note, '')), ''), applied, me.id)
  returning id into sid;
  return sid;
end $$;

-- 取り消し（消さずに残す。在庫を減らしていたら戻す）。入れた本人・店長(自店)・事務員さん
create function public.stock_entry_cancel(p_kind text, p_id uuid) returns boolean
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
    if t.stock_applied then perform app.stock_put_back(t.store_id, t.product_id, t.qty, 'テスターの取り消し', me.id); end if;
  elsif p_kind = 'purchase' then
    select * into s from public.staff_purchases where id = p_id and company_id = me.company_id and cancelled_at is null;
    if s.id is null then raise exception 'not found'; end if;
    if not (me.level = 4 or s.created_by = me.id or (me.level = 3 and me.store_id = s.store_id)) then raise exception 'forbidden'; end if;
    update public.staff_purchases set cancelled_at = now(), cancelled_by = me.id where id = s.id;
    if s.stock_applied then perform app.stock_put_back(s.store_id, s.product_id, s.qty, 'スタッフ購入の取り消し', me.id); end if;
  else raise exception 'bad kind'; end if;
  return true;
end $$;
revoke all on function public.tester_add(uuid, uuid, int, date, text), public.staff_purchase_add(uuid, uuid, int, date, text), public.stock_entry_cancel(text, uuid) from public;
grant execute on function public.tester_add(uuid, uuid, int, date, text), public.staff_purchase_add(uuid, uuid, int, date, text), public.stock_entry_cancel(text, uuid) to app_user;
