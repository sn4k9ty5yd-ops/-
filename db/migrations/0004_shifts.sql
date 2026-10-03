-- Phase 4: シフト（誰が・いつ・何時から何時まで／休み・有給・公休）とお店の基本時間

insert into public.level_permissions (level, permission, scope) values
  (2, 'shift.view', 'own'), (3, 'shift.view', 'all'), (4, 'shift.view', 'all'),   -- 作成中のシフトも見られる
  (2, 'shift.edit', 'own'), (3, 'shift.edit', 'own'), (4, 'shift.edit', 'all');   -- シフトを作る・直す

-- お店の基本時間（オープン/クローズ）。一括入力の初期値になる
alter table public.stores
  add column default_open  time not null default '10:00',
  add column default_close time not null default '19:00';

-- シフトに入る人か（オフィス・事務など、シフト表に載せない人は false）
alter table public.memberships add column on_shift boolean not null default true;

create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  store_id      uuid not null,
  period_id     uuid not null,
  membership_id uuid not null references public.memberships(id),
  day           date not null,
  kind          text not null check (kind in ('work','off','paid','holiday','other')),  -- 出勤/休み/有給/公休/その他
  start_time    time,
  end_time      time,
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  foreign key (period_id, company_id) references public.shift_periods (id, company_id),
  foreign key (store_id, company_id)  references public.stores (id, company_id),
  unique (membership_id, day),
  check ((kind = 'work' and start_time is not null and end_time is not null and end_time > start_time)
      or (kind <> 'work' and start_time is null and end_time is null))
);
create index on public.shifts (company_id, period_id, store_id, day);

-- 編集できる状態か: 受付中〜作成中は誰でも（権限があれば）。確定後はオフィスのみ（確認済みは不可）
create function app.shift_editable(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store
      and (sp.status in ('collecting','closed','drafting')
           or (sp.status <> 'acknowledged' and sp.status <> 'preparing' and app.my_level() = 4))
  )
$$;

alter table public.shifts enable row level security;

-- 見られる人: 権限のある人（作成中も） / スタッフは「公開済み」の自店舗のみ
create policy shifts_select on public.shifts
  for select to app_user
  using (company_id = app.my_company_id() and (
    app.has_perm('shift.view', store_id)
    or (store_id = (app.me()).store_id and app.is_published(period_id, store_id))));
create policy shifts_insert on public.shifts
  for insert to app_user
  with check (company_id = app.my_company_id() and app.has_perm('shift.edit', store_id) and app.shift_editable(period_id, store_id));
create policy shifts_update on public.shifts
  for update to app_user
  using (company_id = app.my_company_id() and app.has_perm('shift.edit', store_id) and app.shift_editable(period_id, store_id))
  with check (company_id = app.my_company_id() and app.has_perm('shift.edit', store_id) and app.shift_editable(period_id, store_id));
create policy shifts_delete on public.shifts
  for delete to app_user
  using (company_id = app.my_company_id() and app.has_perm('shift.edit', store_id) and app.shift_editable(period_id, store_id));

-- 整合性: 日付は期間内、本人の所属店舗のシフトであること
create function app.guard_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.shift_periods; m public.memberships;
begin
  select * into p from public.shift_periods where id = new.period_id;
  if new.day < p.start_date or new.day > p.end_date then raise exception 'date is outside the period'; end if;
  select * into m from public.memberships where id = new.membership_id;
  if m.company_id <> new.company_id or m.store_id <> new.store_id then raise exception 'staff does not belong to this store'; end if;
  if m.status <> 'active' then raise exception 'staff is not active'; end if;
  if not m.on_shift then raise exception 'staff is not on the shift roster'; end if;
  new.updated_at := now();
  new.updated_by := app.uid();
  return new;
end $$;
create trigger shifts_guard before insert or update on public.shifts
  for each row execute function app.guard_shift();

-- 公開後の変更は履歴に残す（誰が・いつ・何を）
create function app.audit_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.shifts; st text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  select status into st from public.store_period_status where period_id = r.period_id and store_id = r.store_id;
  if app.status_rank(st) >= app.status_rank('published') then
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (r.company_id, app.uid(), 'shift.' || lower(tg_op), r.membership_id,
            jsonb_build_object('day', r.day, 'before', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                               'after', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  end if;
  return r;
end $$;
create trigger shifts_audit after insert or update or delete on public.shifts
  for each row execute function app.audit_shift();

grant select, insert, update, delete on public.shifts to app_user;
grant update (name, default_open, default_close) on public.stores to app_user;
grant update (on_shift) on public.memberships to app_user;
grant insert (on_shift) on public.memberships to app_user;
grant select (on_shift) on public.memberships to app_user;
