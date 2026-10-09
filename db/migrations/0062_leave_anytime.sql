-- 有給申請: いつでも、だれでも申請できる「常時の受付」を、会社ごとに1つ持つ（年2回の受付とは別）。
alter table public.leave_windows add column standing boolean not null default false;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.leave_windows'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%400%' loop
    execute format('alter table public.leave_windows drop constraint %I', c);
  end loop;
end $$;
alter table public.leave_windows add constraint leave_windows_range_chk check (range_end >= range_start and (standing or range_end - range_start <= 400));

create function public.leave_standing() returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; wid uuid;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select id into wid from public.leave_windows where company_id = me.company_id and standing;
  if wid is null then
    insert into public.leave_windows (company_id, label, range_start, range_end, status, standing)
      values (me.company_id, '有給申請', date '2020-01-01', date '2099-12-31', 'closed', true) returning id into wid;
  end if;
  return wid;
end $$;
revoke all on function public.leave_standing() from public;
grant execute on function public.leave_standing() to app_user;
