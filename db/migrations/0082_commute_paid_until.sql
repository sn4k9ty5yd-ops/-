-- 定期券: その人について「何日分まで、もらっている（受け取りずみ）」を書いておく（店長=自店・正美さんたち=全員）
alter table public.commute_roster add column paid_until date;
alter table public.commute_roster add column paid_note text not null default '';
create function public.commute_paid_set(p_member uuid, p_until date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; t public.memberships;
begin
  select * into me from app.me();
  select * into t from public.memberships where id = p_member and company_id = me.company_id and status = 'active';
  if me.id is null or me.display_only or me.level < 3 or t.id is null then raise exception 'forbidden'; end if;
  if me.level < 4 and t.store_id <> me.store_id then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.commute_roster where membership_id = t.id) then raise exception 'not on roster'; end if;
  update public.commute_roster set paid_until = p_until, paid_note = left(coalesce(p_note, ''), 200) where membership_id = t.id;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'commute.paid', t.id, jsonb_build_object('until', p_until));
end $$;
revoke all on function public.commute_paid_set(uuid, date, text) from public;
grant execute on function public.commute_paid_set(uuid, date, text) to app_user;
