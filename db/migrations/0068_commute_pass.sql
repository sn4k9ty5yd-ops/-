-- 定期券の提出（毎月1回、写メ）。名簿にいる人だけが出す。事務員さんが確認する。
create table public.commute_settings (
  company_id uuid primary key references public.companies(id),
  due_day int not null default 25 check (due_day between 1 and 28),
  updated_at timestamptz not null default now()
);
create table public.commute_roster (
  membership_id uuid primary key references public.memberships(id),
  company_id uuid not null references public.companies(id),
  added_by uuid,
  created_at timestamptz not null default now()
);
create table public.commute_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  membership_id uuid not null references public.memberships(id),
  month date not null,                                   -- その月の1日
  image text not null default '',
  status text not null default 'submitted' check (status in ('submitted','checked','redo')),
  note text not null default '',
  submitted_at timestamptz not null default now(),
  checked_by uuid,
  checked_at timestamptz,
  unique (membership_id, month)
);
create table public.commute_reminder_log (
  day date not null, membership_id uuid not null, primary key (day, membership_id)
);
alter table public.commute_settings enable row level security;
alter table public.commute_roster enable row level security;
alter table public.commute_submissions enable row level security;
alter table public.commute_reminder_log enable row level security;

-- 見てよい人: 本人 / 店長(自店の人) / 事務員さん以上(全員)
create function app.commute_can_see(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.id = p_member
      or (not m.display_only and m.level >= 3 and (m.level = 4 or exists (select 1 from public.memberships t where t.id = p_member and t.store_id = m.store_id and t.company_id = m.company_id)))
    from app.me() m), false)
$$;
create policy commute_settings_sel on public.commute_settings for select to app_user using (company_id = app.my_company_id());
create policy commute_roster_sel on public.commute_roster for select to app_user using (company_id = app.my_company_id() and app.commute_can_see(membership_id));
create policy commute_sub_sel on public.commute_submissions for select to app_user using (company_id = app.my_company_id() and app.commute_can_see(membership_id));
grant select on public.commute_settings, public.commute_roster to app_user;
grant select (id, company_id, membership_id, month, status, note, submitted_at, checked_by, checked_at) on public.commute_submissions to app_user;   -- 写真は、関数からだけ

-- 名簿に入れる・外す（店長=自店の人、事務員さん=全員）
create function public.commute_roster_set(p_member uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; t public.memberships;
begin
  select * into me from app.me();
  select * into t from public.memberships where id = p_member and company_id = me.company_id and status = 'active';
  if me.id is null or me.display_only or me.level < 3 or t.id is null or t.display_only then raise exception 'forbidden'; end if;
  if me.level < 4 and t.store_id <> me.store_id then raise exception 'forbidden'; end if;
  if p_on then insert into public.commute_roster (membership_id, company_id, added_by) values (t.id, me.company_id, me.id) on conflict do nothing;
  else delete from public.commute_roster where membership_id = t.id; end if;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'commute.roster', t.id, jsonb_build_object('on', p_on));
end $$;

-- 提出（名簿の本人だけ。今月と先月ぶん。確認済みは出し直せない）
create function public.commute_submit(p_month date, p_image text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; id uuid; cur date := date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date; ex public.commute_submissions;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or not exists (select 1 from public.commute_roster where membership_id = me.id) then raise exception 'forbidden'; end if;
  if p_month <> cur and p_month <> (cur - interval '1 month')::date then raise exception 'bad month'; end if;
  if p_image is null or p_image !~ '^data:image/(jpeg|png|webp);base64,' or length(p_image) > 2000000 then raise exception 'bad image'; end if;
  select * into ex from public.commute_submissions where membership_id = me.id and month = p_month;
  if ex.id is not null and ex.status = 'checked' then raise exception 'locked'; end if;
  insert into public.commute_submissions (company_id, membership_id, month, image) values (me.company_id, me.id, p_month, p_image)
    on conflict (membership_id, month) do update set image = excluded.image, status = 'submitted', note = '', submitted_at = now(), checked_by = null, checked_at = null
    returning commute_submissions.id into id;
  return id;
end $$;

-- 事務員さんの確認（確認済み／やり直し）
create function public.commute_check(p_id uuid, p_status text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; s public.commute_submissions;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level < 4 or p_status not in ('checked','redo') then raise exception 'forbidden'; end if;
  select * into s from public.commute_submissions where id = p_id and company_id = me.company_id;
  if s.id is null then raise exception 'forbidden'; end if;
  update public.commute_submissions set status = p_status, note = left(coalesce(p_note,''), 200), checked_by = me.id, checked_at = now() where id = p_id;
  return s.membership_id;
end $$;

-- 写真を見る（本人と事務員さん以上だけ）
create function public.commute_image(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; s public.commute_submissions;
begin
  select * into me from app.me();
  select * into s from public.commute_submissions where id = p_id and company_id = me.company_id;
  if me.id is null or s.id is null or not (s.membership_id = me.id or (me.level = 4 and not me.display_only)) then raise exception 'forbidden'; end if;
  return s.image;
end $$;

-- 提出の期限日（毎月◯日まで）。事務員さんが決める
create function public.commute_set_due(p_day int) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships;
begin
  select * into me from app.me();
  if me.id is null or me.display_only or me.level < 4 or p_day < 1 or p_day > 28 then raise exception 'forbidden'; end if;
  insert into public.commute_settings (company_id, due_day) values (me.company_id, p_day)
    on conflict (company_id) do update set due_day = excluded.due_day, updated_at = now();
end $$;
grant execute on function public.commute_roster_set(uuid, boolean), public.commute_submit(date, text), public.commute_check(uuid, text, text),
  public.commute_image(uuid), public.commute_set_due(int) to app_user;
