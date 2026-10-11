-- 「カレンダーだけの人」（社長・役員など）: 出勤簿（入店・退店・休憩の表）には入れず、シフトのカレンダーには名前を出す。
-- 休みの日だけをシフト担当が入れ、休みでない日は「出勤」として出る。出勤するお店と日にちは、月の日付（1〜31日）の範囲で決める。
alter table public.memberships add column calendar_only boolean not null default false;
grant select (calendar_only) on public.memberships to app_user;

create table public.calendar_stints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  membership_id uuid not null references public.memberships(id),
  store_id uuid not null references public.stores(id),
  from_day int not null check (from_day between 1 and 31),
  to_day int not null check (to_day between 1 and 31)
);
create index on public.calendar_stints (membership_id);
create index on public.calendar_stints (store_id);
alter table public.calendar_stints enable row level security;
create policy cs_select on public.calendar_stints for select to app_user using (company_id = app.my_company_id());
grant select on public.calendar_stints to app_user;

-- 「カレンダーだけの人」の名前は、出勤するお店の人にも見える（所属は別のお店でも）
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to app_user
  using (company_id = app.my_company_id() and (id = app.uid() or app.has_perm('staff.view', store_id)
         or (calendar_only and exists (select 1 from public.calendar_stints c where c.membership_id = memberships.id and c.store_id = (select m.store_id from app.me() m)))));

-- 決められるのは、正美さんたち（レベル4）だけ
create function public.calendar_member_set(p_member uuid, p_on boolean, p_stints jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; t public.memberships; s jsonb;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level < 4 then raise exception 'forbidden'; end if;
  select * into t from public.memberships where id = p_member and company_id = me.company_id and status = 'active';
  if t.id is null or t.display_only then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_stints) <> 'array' or jsonb_array_length(p_stints) > 12 then raise exception 'bad stints'; end if;
  update public.memberships set calendar_only = p_on, on_shift = case when p_on then false else on_shift end where id = t.id;
  delete from public.calendar_stints where membership_id = t.id;
  if p_on then
    for s in select * from jsonb_array_elements(p_stints) loop
      if not exists (select 1 from public.stores where id = (s->>'storeId')::uuid and company_id = me.company_id) then raise exception 'bad store'; end if;
      if (s->>'fromDay')::int not between 1 and 31 or (s->>'toDay')::int not between 1 and 31 then raise exception 'bad day'; end if;
      insert into public.calendar_stints (company_id, membership_id, store_id, from_day, to_day) values (me.company_id, t.id, (s->>'storeId')::uuid, (s->>'fromDay')::int, (s->>'toDay')::int);
    end loop;
  end if;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'calendar.member', t.id, jsonb_build_object('on', p_on, 'stints', p_stints));
end $$;
revoke all on function public.calendar_member_set(uuid, boolean, jsonb) from public;
grant execute on function public.calendar_member_set(uuid, boolean, jsonb) to app_user;

-- シフトの整合性: カレンダーだけの人は、出勤するお店（上の範囲）のシフトに休みを入れられる（所属店舗・「シフトに入る」でなくてよい）
create or replace function app.guard_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.shift_periods; m public.memberships;
begin
  select * into p from public.shift_periods where id = new.period_id;
  if new.day < p.start_date or new.day > p.end_date then raise exception 'date is outside the period'; end if;
  select * into m from public.memberships where id = new.membership_id;
  if m.company_id <> new.company_id then raise exception 'staff does not belong to this store'; end if;
  if m.calendar_only then
    if not exists (select 1 from public.calendar_stints s where s.membership_id = m.id and s.store_id = new.store_id) then raise exception 'staff does not belong to this store'; end if;
    if new.kind = 'work' then raise exception 'calendar-only staff has no work rows'; end if;
  else
    if m.store_id <> new.store_id then raise exception 'staff does not belong to this store'; end if;
    if not m.on_shift then raise exception 'staff is not on the shift roster'; end if;
  end if;
  if m.status <> 'active' then raise exception 'staff is not active'; end if;
  new.updated_at := now();
  new.updated_by := app.uid();
  return new;
end $$;

-- 社長（鬼塚さん）: 毎月16〜31日は天神店、1〜15日はオルガン
update public.memberships set calendar_only = true, on_shift = false where level = 4 and name like '鬼塚%' and status = 'active';
insert into public.calendar_stints (company_id, membership_id, store_id, from_day, to_day)
  select m.company_id, m.id, s.id, 16, 31 from public.memberships m join public.stores s on s.company_id = m.company_id and (s.name like '%天神%' or s.name = 'ATENA')
   where m.calendar_only and m.name like '鬼塚%' and m.level = 4;
insert into public.calendar_stints (company_id, membership_id, store_id, from_day, to_day)
  select m.company_id, m.id, s.id, 1, 15 from public.memberships m join public.stores s on s.company_id = m.company_id and lower(s.name) like 'organ%'
   where m.calendar_only and m.name like '鬼塚%' and m.level = 4;
