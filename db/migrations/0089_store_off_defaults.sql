-- お店ごとの「1日に休める人数」の標準（お店ごとに条件がちがう）。期間ごとに「全部の日に決める」とき、最初から入っている。
create table public.store_off_defaults (
  store_id uuid primary key references public.stores(id),
  company_id uuid not null references public.companies(id),
  stylist int not null check (stylist between 0 and 99),
  assistant int not null check (assistant between 0 and 99),   -- アシスタント全体
  assistant1 int check (assistant1 between 0 and 99),            -- 1年目・2年目で分けるときだけ
  assistant2 int check (assistant2 between 0 and 99),
  updated_at timestamptz not null default now()
);
alter table public.store_off_defaults enable row level security;
alter table public.store_off_defaults force row level security;
create policy sod_select on public.store_off_defaults for select to app_user using (company_id = app.my_company_id());
grant select on public.store_off_defaults to app_user;

create function public.store_off_default_set(p_store uuid, p_stylist int, p_assistant int, p_a1 int, p_a2 int) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or not app.has_perm('period.manage', p_store) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.stores where id = p_store and company_id = me.company_id) then raise exception 'forbidden'; end if;
  insert into public.store_off_defaults (store_id, company_id, stylist, assistant, assistant1, assistant2) values (p_store, me.company_id, p_stylist, p_assistant, p_a1, p_a2)
  on conflict (store_id) do update set stylist = excluded.stylist, assistant = excluded.assistant, assistant1 = excluded.assistant1, assistant2 = excluded.assistant2, updated_at = now();
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'store.off_default', p_store, jsonb_build_object('stylist', p_stylist, 'assistant', p_assistant, 'a1', p_a1, 'a2', p_a2));
end $$;
revoke all on function public.store_off_default_set(uuid, int, int, int, int) from public;
grant execute on function public.store_off_default_set(uuid, int, int, int, int) to app_user;

-- 六本松: スタイリスト1人・アシスタント1人（アシスタントは1年目・2年目を分けず、全体で1人）
insert into public.store_off_defaults (store_id, company_id, stylist, assistant)
select id, company_id, 1, 1 from public.stores where name like '%六本松%';
