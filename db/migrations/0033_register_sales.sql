-- レジ売上（レジの「月間スタッフ売上表」と同じ形）。お店×月ごと。見られるのは、そのお店の人と事務員さん(Lv4)だけ。
create table public.register_sales_status (
  company_id   uuid not null references public.companies(id),
  store_id     uuid not null,
  month        date not null check (extract(day from month) = 1),
  days         int  not null default 0 check (days between 0 and 31),   -- 稼働日数
  status       text not null default 'entered' check (status in ('entered','confirmed')),
  entered_by   uuid references public.memberships(id),
  entered_at   timestamptz not null default now(),
  confirmed_by uuid references public.memberships(id),
  confirmed_at timestamptz,
  primary key (store_id, month),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);

create table public.register_sales (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  store_id      uuid not null,
  month         date not null,
  row_no        int  not null,
  name          text not null,
  membership_id uuid references public.memberships(id),     -- 名前が合う人（合えば）
  tech_before bigint not null default 0, tech_discount bigint not null default 0, tech_tax bigint not null default 0, tech_total bigint not null default 0,
  goods_before bigint not null default 0, goods_discount bigint not null default 0, goods_tax bigint not null default 0, goods_total bigint not null default 0,
  all_before bigint not null default 0, all_discount bigint not null default 0, all_tax bigint not null default 0, all_total bigint not null default 0,
  new_count int not null default 0, repeat_count int not null default 0, fixed_count int not null default 0,
  gobusata_count int not null default 0, guest_count int not null default 0, total_count int not null default 0,
  unique (store_id, month, row_no),
  foreign key (store_id, month) references public.register_sales_status (store_id, month) on delete cascade
);

alter table public.register_sales_status enable row level security;
alter table public.register_sales enable row level security;
create policy rss_select on public.register_sales_status for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.my_level() = 4 or store_id = (app.me()).store_id));
create policy rs_select on public.register_sales for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.my_level() = 4 or store_id = (app.me()).store_id));
grant select on public.register_sales_status, public.register_sales to app_user;

-- 入れる（シフト担当以上・自店 / 事務員さんは全店）。確認済みのあとは、確認を戻してから
create function public.register_save(p_store uuid, p_month date, p_days int, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; st public.register_sales_status; r jsonb; i int := 0; mid uuid; nm text;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level < 2 then raise exception 'forbidden'; end if;
  if me.level < 4 and me.store_id <> p_store then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.stores where id = p_store and company_id = me.company_id) then raise exception 'forbidden'; end if;
  if extract(day from p_month) <> 1 then raise exception 'bad month'; end if;
  if p_days < 0 or p_days > 31 then raise exception 'bad days'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 80 then raise exception 'bad rows'; end if;
  select * into st from public.register_sales_status where store_id = p_store and month = p_month;
  if st.store_id is not null and st.status = 'confirmed' then raise exception 'locked'; end if;
  if st.store_id is null then
    insert into public.register_sales_status (company_id, store_id, month, days, entered_by) values (me.company_id, p_store, p_month, p_days, me.id);
  else
    delete from public.register_sales where store_id = p_store and month = p_month;
    update public.register_sales_status set days = p_days, entered_by = me.id, entered_at = now() where store_id = p_store and month = p_month;
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    nm := left(btrim(coalesce(r->>'name','')), 40);
    if nm = '' then continue; end if;
    select m.id into mid from public.memberships m
      where m.company_id = me.company_id and m.store_id = p_store
        and regexp_replace(m.name, '[[:space:]　]', '', 'g') = regexp_replace(nm, '[[:space:]　]', '', 'g')
      order by (m.status = 'active') desc limit 1;
    insert into public.register_sales (company_id, store_id, month, row_no, name, membership_id,
      tech_before, tech_discount, tech_tax, tech_total, goods_before, goods_discount, goods_tax, goods_total,
      all_before, all_discount, all_tax, all_total, new_count, repeat_count, fixed_count, gobusata_count, guest_count, total_count)
    values (me.company_id, p_store, p_month, i, nm, mid,
      least(greatest(coalesce((r->>'techBefore')::bigint,0),0),10000000000), least(greatest(coalesce((r->>'techDiscount')::bigint,0),0),10000000000),
      least(greatest(coalesce((r->>'techTax')::bigint,0),0),10000000000), least(greatest(coalesce((r->>'techTotal')::bigint,0),0),10000000000),
      least(greatest(coalesce((r->>'goodsBefore')::bigint,0),0),10000000000), least(greatest(coalesce((r->>'goodsDiscount')::bigint,0),0),10000000000),
      least(greatest(coalesce((r->>'goodsTax')::bigint,0),0),10000000000), least(greatest(coalesce((r->>'goodsTotal')::bigint,0),0),10000000000),
      least(greatest(coalesce((r->>'allBefore')::bigint,0),0),10000000000), least(greatest(coalesce((r->>'allDiscount')::bigint,0),0),10000000000),
      least(greatest(coalesce((r->>'allTax')::bigint,0),0),10000000000), least(greatest(coalesce((r->>'allTotal')::bigint,0),0),10000000000),
      least(greatest(coalesce((r->>'newCount')::int,0),0),100000), least(greatest(coalesce((r->>'repeatCount')::int,0),0),100000),
      least(greatest(coalesce((r->>'fixedCount')::int,0),0),100000), least(greatest(coalesce((r->>'gobusataCount')::int,0),0),100000),
      least(greatest(coalesce((r->>'guestCount')::int,0),0),100000), least(greatest(coalesce((r->>'totalCount')::int,0),0),100000));
  end loop;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
  values (me.company_id, me.id, 'register.save', p_store, jsonb_build_object('month', p_month, 'rows', i));
end $$;

-- 事務員さんの確認（on=確認済みにする / off=入力済みに戻す）
create function public.register_confirm(p_store uuid, p_month date, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; n int;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level < 4 then raise exception 'forbidden'; end if;
  if p_on then
    update public.register_sales_status set status = 'confirmed', confirmed_by = me.id, confirmed_at = now()
     where store_id = p_store and month = p_month and company_id = me.company_id and status = 'entered';
  else
    update public.register_sales_status set status = 'entered', confirmed_by = null, confirmed_at = null
     where store_id = p_store and month = p_month and company_id = me.company_id and status = 'confirmed';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not found'; end if;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
  values (me.company_id, me.id, case when p_on then 'register.confirm' else 'register.unconfirm' end, p_store, jsonb_build_object('month', p_month));
end $$;
grant execute on function public.register_save(uuid, date, int, jsonb), public.register_confirm(uuid, date, boolean) to app_user;
