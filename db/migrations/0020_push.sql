-- スマホへの通知（Web Push・無料）。端末の登録、朝の「今日のメンバー」通知の設定。
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  membership_id uuid not null references public.memberships(id),
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index on public.push_subscriptions (membership_id);
alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for all to app_user
  using (company_id = app.my_company_id() and membership_id = app.uid())
  with check (company_id = app.my_company_id() and membership_id = app.uid());
grant select, insert, delete on public.push_subscriptions to app_user;

-- 通知の鍵（アプリ用ロールからは読めない。サーバーだけが使う）
create table public.push_config (
  id          int primary key check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);

-- 朝の通知: お店ごとに、使う／使わない・時刻（5分刻み）。初期は全店オン・8:30
alter table public.stores
  add column notice_enabled   boolean not null default true,
  add column notice_time      time    not null default '08:30',
  add column notice_last_sent date;

-- 店長(自店)・管理者(全店)が、朝の通知の設定を変えられる
create function public.set_store_notice(p_store uuid, p_enabled boolean, p_time time) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not app.has_perm('staff.manage', p_store) then return false; end if;
  if extract(minute from p_time)::int % 5 <> 0 then raise exception 'time must be 5 minute steps'; end if;
  update public.stores set notice_enabled = p_enabled, notice_time = p_time where id = p_store and company_id = app.my_company_id();
  return found;
end $$;
revoke all on function public.set_store_notice(uuid, boolean, time) from public;
grant execute on function public.set_store_notice(uuid, boolean, time) to app_user;
