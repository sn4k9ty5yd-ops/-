-- 休める人数の上限を、アシスタントの「1年目」「2年目」でも分けて決められるようにする。
-- max_assistant は、これまでどおり「アシスタント全体」（1年目＋2年目を決めたときは、その合計）
alter table public.day_limits add column max_assistant1 int check (max_assistant1 between 0 and 99), add column max_assistant2 int check (max_assistant2 between 0 and 99);

drop function app.period_conflicts(uuid, uuid);
create function app.period_conflicts(p uuid, s uuid)
returns table (day date, max_off int, cnt int, max_stylist int, cnt_stylist int, max_assistant int, cnt_assistant int, max_assistant1 int, cnt_assistant1 int, max_assistant2 int, cnt_assistant2 int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not app.has_perm('shift.view', s) then return; end if;
  return query
    with off_people as (
      select u.day, u.membership_id, m.rank, m.assistant_year from (
        select day, membership_id from public.shifts where period_id = p and store_id = s and kind <> 'work'
        union
        select day, membership_id from public.time_off_requests where period_id = p and store_id = s) u
      join public.memberships m on m.id = u.membership_id),
    c as (
      select l.day, l.max_off, l.max_stylist, l.max_assistant, l.max_assistant1, l.max_assistant2,
             (select count(*)::int from off_people o where o.day = l.day) as cnt,
             (select count(*)::int from off_people o where o.day = l.day and o.rank = 'stylist') as cs,
             (select count(*)::int from off_people o where o.day = l.day and o.rank = 'assistant') as ca,
             (select count(*)::int from off_people o where o.day = l.day and o.rank = 'assistant' and o.assistant_year = 1) as ca1,
             (select count(*)::int from off_people o where o.day = l.day and o.rank = 'assistant' and o.assistant_year = 2) as ca2
        from public.day_limits l where l.period_id = p and l.store_id = s and l.company_id = app.my_company_id())
    select c.day, c.max_off, c.cnt, c.max_stylist, c.cs, c.max_assistant, c.ca, c.max_assistant1, c.ca1, c.max_assistant2, c.ca2 from c
     where c.cnt > c.max_off or c.cs > coalesce(c.max_stylist, 99) or c.ca > coalesce(c.max_assistant, 99)
        or c.ca1 > coalesce(c.max_assistant1, 99) or c.ca2 > coalesce(c.max_assistant2, 99)
     order by c.day;
end $$;
grant execute on function app.period_conflicts(uuid, uuid) to app_user;
