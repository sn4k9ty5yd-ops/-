-- ヘッドスパの申請: 売上の表とは別に、本人が「単価×人数」を入れて申請 → 店長が確認
create table public.spa_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  store_id uuid not null references public.stores(id),
  membership_id uuid not null references public.memberships(id),
  month date not null,
  lines jsonb not null default '[]',
  people int not null default 0,
  gross int not null default 0,
  status text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  return_comment text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (membership_id, month)
);
create index on public.spa_claims (store_id, month);
alter table public.spa_claims enable row level security;
create policy spa_select on public.spa_claims for select to app_user using (company_id = app.my_company_id() and app.sales_visible(store_id, membership_id));
grant select on public.spa_claims to app_user;

create function public.spa_claim_save(p_month date, p_lines jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.spa_claims; l jsonb; pc int := 0; gs bigint := 0; n int;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level >= 4 then raise exception 'forbidden'; end if;
  if extract(day from p_month) <> 1 then raise exception 'bad month'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'bad value'; end if;
  n := jsonb_array_length(p_lines);
  if n > 30 then raise exception 'bad value'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'price') is null or (l->>'count') is null or (l->>'price') !~ '^[0-9]{1,7}$' or (l->>'count') !~ '^[0-9]{1,4}$' then raise exception 'bad value'; end if;
    if (l->>'count')::int < 1 then raise exception 'bad value'; end if;
    pc := pc + (l->>'count')::int;
    gs := gs + (l->>'price')::bigint * (l->>'count')::int;
  end loop;
  if gs > 1000000000 then raise exception 'bad value'; end if;
  select * into cur from public.spa_claims where membership_id = me.id and month = p_month;
  if cur.id is not null and cur.status not in ('draft','returned') then raise exception 'locked'; end if;
  if cur.id is null then
    insert into public.spa_claims (company_id, store_id, membership_id, month, lines, people, gross, status) values (me.company_id, me.store_id, me.id, p_month, p_lines, pc, gs::int, 'draft');
    return 'draft';
  end if;
  update public.spa_claims set lines = p_lines, people = pc, gross = gs::int, updated_at = now() where id = cur.id;
  return cur.status;
end $$;

create function public.spa_claim_submit(p_month date) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.spa_claims;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level >= 4 then raise exception 'forbidden'; end if;
  select * into cur from public.spa_claims where membership_id = me.id and month = p_month;
  if cur.id is null or cur.people < 1 then raise exception 'no data'; end if;
  if cur.status not in ('draft','returned') then raise exception 'locked'; end if;
  update public.spa_claims set status = 'submitted', return_comment = null, updated_at = now() where id = cur.id;
  return 'submitted';
end $$;

create function public.spa_claim_review(p_member uuid, p_month date, p_action text, p_comment text) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.spa_claims;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into cur from public.spa_claims where membership_id = p_member and month = p_month and company_id = me.company_id;
  if cur.id is null then raise exception 'not found'; end if;
  if cur.membership_id = me.id then raise exception 'own'; end if;
  if not (me.level = 4 or (me.level = 3 and me.store_id = cur.store_id)) then raise exception 'forbidden'; end if;
  if p_action = 'approve' then
    if cur.status <> 'submitted' then raise exception 'wrong status'; end if;
    update public.spa_claims set status = 'approved', reviewed_by = me.id, reviewed_at = now(), updated_at = now() where id = cur.id;
    return 'approved';
  elsif p_action = 'return' then
    if cur.status not in ('submitted','approved') then raise exception 'wrong status'; end if;
    update public.spa_claims set status = 'returned', return_comment = left(coalesce(p_comment, ''), 300), reviewed_by = me.id, reviewed_at = now(), updated_at = now() where id = cur.id;
    return 'returned';
  end if;
  raise exception 'bad action';
end $$;
revoke all on function public.spa_claim_save(date,jsonb), public.spa_claim_submit(date), public.spa_claim_review(uuid,date,text,text) from public;
grant execute on function public.spa_claim_save(date,jsonb), public.spa_claim_submit(date), public.spa_claim_review(uuid,date,text,text) to app_user;
