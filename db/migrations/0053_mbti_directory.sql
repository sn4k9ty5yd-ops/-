-- みんなのMBTI: スタイリストだけが、全員のMBTIを見られる（名前・お店・MBTIだけ。メンターの会話は見えない）
create function public.mbti_directory() returns table (name text, store_name text, rank text, mbti text)
language plpgsql stable security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.status <> 'active' or me.rank is distinct from 'stylist' then return; end if;
  return query
    select m.name, s.name, m.rank, p.mbti
      from public.mentor_profiles p join public.memberships m on m.id = p.membership_id join public.stores s on s.id = m.store_id
     where p.company_id = me.company_id and p.mbti is not null and m.status = 'active' and not m.display_only
     order by s.sort_order, s.name, m.name;
end $$;
revoke all on function public.mbti_directory() from public;
grant execute on function public.mbti_directory() to app_user;
