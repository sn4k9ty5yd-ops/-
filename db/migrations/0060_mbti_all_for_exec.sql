-- みんなのMBTI: 全店が見られるのは、社長以上（レベル4以上）だけ。ほかの人（スタイリストも）は、自分のお店の人だけ
create or replace function public.mbti_directory() returns table (name text, store_name text, rank text, mbti text)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.status <> 'active' then return; end if;
  return query
    select m.name, s.name, m.rank, p.mbti
      from public.mentor_profiles p join public.memberships m on m.id = p.membership_id join public.stores s on s.id = m.store_id
     where p.company_id = me.company_id and p.mbti is not null and m.status = 'active' and not m.display_only
       and (me.level >= 4 or m.store_id = me.store_id)
     order by s.sort_order, s.name, m.name;
end $$;
