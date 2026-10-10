-- 定期券の期限（何月何日まで）: 本人も自分の分を書ける。期限の1週間前から毎日通知する（通知のおぼえ書き）
create or replace function public.commute_paid_set(p_member uuid, p_until date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; t public.memberships;
begin
  select * into me from app.me();
  select * into t from public.memberships where id = p_member and company_id = me.company_id and status = 'active';
  if me.id is null or me.display_only or t.id is null then raise exception 'forbidden'; end if;
  if me.id <> t.id then
    if me.level < 3 then raise exception 'forbidden'; end if;
    if me.level < 4 and t.store_id <> me.store_id then raise exception 'forbidden'; end if;
  end if;
  if not exists (select 1 from public.commute_roster where membership_id = t.id) then raise exception 'not on roster'; end if;
  update public.commute_roster set paid_until = p_until, paid_note = left(coalesce(p_note, ''), 200) where membership_id = t.id;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'commute.paid', t.id, jsonb_build_object('until', p_until));
end $$;
create table public.commute_expiry_log (
  day date not null, membership_id uuid not null, primary key (day, membership_id)
);
alter table public.commute_expiry_log enable row level security;
