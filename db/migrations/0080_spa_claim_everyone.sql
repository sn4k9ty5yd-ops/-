-- ヘッドスパの申請を、レベル4（正美さん・アプリ制作者など）もできるようにする
create or replace function public.spa_claim_save(p_month date, p_lines jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.spa_claims; l jsonb; pc int := 0; gs bigint := 0; n int;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
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

create or replace function public.spa_claim_submit(p_month date) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; cur public.spa_claims;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into cur from public.spa_claims where membership_id = me.id and month = p_month;
  if cur.id is null or cur.people < 1 then raise exception 'no data'; end if;
  if cur.status not in ('draft','returned') then raise exception 'locked'; end if;
  update public.spa_claims set status = 'submitted', return_comment = null, updated_at = now() where id = cur.id;
  return 'submitted';
end $$;

