-- 定期券：何ヶ月分か（1・3・6）を、提出のときに書く。期限日の初期値は15日
alter table public.commute_submissions add column months int check (months in (1, 3, 6));
alter table public.commute_settings alter column due_day set default 15;
grant select (months) on public.commute_submissions to app_user;
drop function public.commute_submit(date, text);
create function public.commute_submit(p_month date, p_image text, p_months int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; id uuid; cur date := date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date; ex public.commute_submissions;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or not exists (select 1 from public.commute_roster where membership_id = me.id) then raise exception 'forbidden'; end if;
  if p_month <> cur and p_month <> (cur - interval '1 month')::date then raise exception 'bad month'; end if;
  if p_months is null or p_months not in (1, 3, 6) then raise exception 'bad months'; end if;
  if p_image is null or p_image !~ '^data:image/(jpeg|png|webp);base64,' or length(p_image) > 2000000 then raise exception 'bad image'; end if;
  select * into ex from public.commute_submissions where membership_id = me.id and month = p_month;
  if ex.id is not null and ex.status = 'checked' then raise exception 'locked'; end if;
  insert into public.commute_submissions (company_id, membership_id, month, image, months) values (me.company_id, me.id, p_month, p_image, p_months)
    on conflict (membership_id, month) do update set image = excluded.image, months = excluded.months, status = 'submitted', note = '', submitted_at = now(), checked_by = null, checked_at = null
    returning commute_submissions.id into id;
  return id;
end $$;
grant execute on function public.commute_submit(date, text, int) to app_user;
