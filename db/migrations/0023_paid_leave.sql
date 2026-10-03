-- 有給の年2回の提出と、変更の申請（スタッフ → 店長が確認 → 事務員さんが許可）。アプリの中で完結する。
create table public.leave_windows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  label       text not null check (length(btrim(label)) between 1 and 40),
  range_start date not null,          -- 有給を取れる日の範囲
  range_end   date not null,
  status      text not null default 'open' check (status in ('open','closed')),   -- 受付中／締切
  created_at  timestamptz not null default now(),
  created_by  uuid references public.memberships(id),
  check (range_end >= range_start and range_end - range_start <= 400)
);
create table public.leave_plans (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  window_id     uuid not null references public.leave_windows(id),
  store_id      uuid not null,
  membership_id uuid not null references public.memberships(id),
  day           date not null,
  created_at    timestamptz not null default now(),
  unique (window_id, membership_id, day),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.leave_plans (window_id, store_id);
create table public.leave_submissions (
  window_id     uuid not null references public.leave_windows(id),
  membership_id uuid not null references public.memberships(id),
  company_id    uuid not null,
  store_id      uuid not null,
  submitted_at  timestamptz not null default now(),
  primary key (window_id, membership_id)
);
create table public.leave_changes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  window_id     uuid not null references public.leave_windows(id),
  store_id      uuid not null,
  membership_id uuid not null references public.memberships(id),
  from_day      date,                 -- いまの有給の日（新しく足すときは空）
  to_day        date,                 -- 変えたい先の日（やめるときは空）
  reason        text not null default '' check (length(reason) <= 300),
  status        text not null default 'pending_manager' check (status in ('pending_manager','pending_office','approved','rejected','cancelled')),
  manager_id    uuid, manager_at timestamptz, manager_comment text,
  office_id     uuid, office_at  timestamptz, office_comment  text,
  created_at    timestamptz not null default now(),
  check (from_day is not null or to_day is not null)
);
create index on public.leave_changes (status, store_id);

alter table public.leave_windows     enable row level security;
alter table public.leave_plans       enable row level security;
alter table public.leave_submissions enable row level security;
alter table public.leave_changes     enable row level security;

-- 見られる範囲: 自分／店長は自店／管理者(事務員さん)は全店
create function app.leave_visible(p_store uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.level = 4 or p_member = m.id or (m.level = 3 and m.store_id = p_store) from app.me() m where not m.display_only), false)
$$;
grant execute on function app.leave_visible(uuid, uuid) to app_user;

create policy lw_select on public.leave_windows for select to app_user using (company_id = app.my_company_id() and not app.me_display_only());
create policy lw_insert on public.leave_windows for insert to app_user with check (company_id = app.my_company_id() and app.my_level() = 4);
create policy lw_update on public.leave_windows for update to app_user using (company_id = app.my_company_id() and app.my_level() = 4) with check (company_id = app.my_company_id() and app.my_level() = 4);
create policy lp_select on public.leave_plans for select to app_user using (company_id = app.my_company_id() and app.leave_visible(store_id, membership_id));
-- 自分の有給の日は、受付中のあいだだけ、自分で入れたり消したりできる
create policy lp_insert on public.leave_plans for insert to app_user with check (
  company_id = app.my_company_id() and membership_id = app.uid() and store_id = (app.me()).store_id and not app.me_display_only()
  and exists (select 1 from public.leave_windows w where w.id = window_id and w.status = 'open' and day between w.range_start and w.range_end));
create policy lp_delete on public.leave_plans for delete to app_user using (
  company_id = app.my_company_id() and membership_id = app.uid() and exists (select 1 from public.leave_windows w where w.id = window_id and w.status = 'open'));
create policy ls_select on public.leave_submissions for select to app_user using (company_id = app.my_company_id() and app.leave_visible(store_id, membership_id));
create policy ls_insert on public.leave_submissions for insert to app_user with check (
  company_id = app.my_company_id() and membership_id = app.uid() and store_id = (app.me()).store_id
  and exists (select 1 from public.leave_windows w where w.id = window_id and w.status = 'open'));
create policy ls_delete on public.leave_submissions for delete to app_user using (
  company_id = app.my_company_id() and membership_id = app.uid() and exists (select 1 from public.leave_windows w where w.id = window_id and w.status = 'open'));
create policy lc_sel on public.leave_changes for select to app_user using (company_id = app.my_company_id() and app.leave_visible(store_id, membership_id));

grant select, insert, update on public.leave_windows to app_user;
grant select, insert, delete on public.leave_plans to app_user;
grant select, insert, delete on public.leave_submissions to app_user;
grant select on public.leave_changes to app_user;

-- 変更の申請（締切後）。店長・事務員さんの確認の順番は、ここで決まる
create function public.leave_request(p_window uuid, p_from date, p_to date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; w public.leave_windows; new_id uuid;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into w from public.leave_windows where id = p_window and company_id = me.company_id;
  if w.id is null then raise exception 'window not found'; end if;
  if w.status <> 'closed' then raise exception 'window open'; end if;
  if p_from is null and p_to is null then raise exception 'empty'; end if;
  if p_from is not null and not exists (select 1 from public.leave_plans where window_id = w.id and membership_id = me.id and day = p_from) then raise exception 'no such plan'; end if;
  if p_to is not null and (p_to < w.range_start or p_to > w.range_end) then raise exception 'out of range'; end if;
  if p_to is not null and exists (select 1 from public.leave_plans where window_id = w.id and membership_id = me.id and day = p_to) then raise exception 'already planned'; end if;
  if exists (select 1 from public.leave_changes where window_id = w.id and membership_id = me.id and status in ('pending_manager','pending_office')
             and (from_day is not distinct from p_from) and (to_day is not distinct from p_to)) then raise exception 'duplicate'; end if;
  insert into public.leave_changes (company_id, window_id, store_id, membership_id, from_day, to_day, reason, status)
    values (me.company_id, w.id, me.store_id, me.id, p_from, p_to, coalesce(p_reason, ''), case when me.level >= 3 then 'pending_office' else 'pending_manager' end)
    returning id into new_id;
  return new_id;
end $$;

-- 許可／却下。店長(自店)が先に確認 → 事務員さん(管理者)が許可。許可されたら、有給の日が書き換わる
create function public.leave_decide(p_id uuid, p_approve boolean, p_comment text) returns text
language plpgsql security definer set search_path = public as $$
declare me public.memberships; c public.leave_changes;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into c from public.leave_changes where id = p_id and company_id = me.company_id for update;
  if c.id is null then raise exception 'not found'; end if;
  if c.membership_id = me.id then raise exception 'own request'; end if;
  if c.status = 'pending_manager' then
    if not (me.level = 4 or (me.level = 3 and me.store_id = c.store_id)) then raise exception 'forbidden'; end if;
    update public.leave_changes set status = case when p_approve then 'pending_office' else 'rejected' end,
           manager_id = me.id, manager_at = now(), manager_comment = left(coalesce(p_comment, ''), 300) where id = c.id;
    return case when p_approve then 'pending_office' else 'rejected' end;
  elsif c.status = 'pending_office' then
    if me.level <> 4 then raise exception 'forbidden'; end if;
    if p_approve then
      if c.from_day is not null then delete from public.leave_plans where window_id = c.window_id and membership_id = c.membership_id and day = c.from_day; end if;
      if c.to_day is not null then
        insert into public.leave_plans (company_id, window_id, store_id, membership_id, day) values (c.company_id, c.window_id, c.store_id, c.membership_id, c.to_day) on conflict do nothing;
      end if;
    end if;
    update public.leave_changes set status = case when p_approve then 'approved' else 'rejected' end,
           office_id = me.id, office_at = now(), office_comment = left(coalesce(p_comment, ''), 300) where id = c.id;
    return case when p_approve then 'approved' else 'rejected' end;
  end if;
  raise exception 'already decided';
end $$;

create function public.leave_cancel(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.leave_changes set status = 'cancelled' where id = p_id and membership_id = app.uid() and status in ('pending_manager','pending_office');
  return found;
end $$;
revoke all on function public.leave_request(uuid, date, date, text), public.leave_decide(uuid, boolean, text), public.leave_cancel(uuid) from public;
grant execute on function public.leave_request(uuid, date, date, text), public.leave_decide(uuid, boolean, text), public.leave_cancel(uuid) to app_user;
