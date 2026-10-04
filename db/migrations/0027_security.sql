-- セキュリティ強化: パスコードを本人が変える／発行されたパスコードは最初に変えてもらう／ログインの記録
alter table public.memberships add column passcode_must_change boolean not null default false;
grant select (passcode_must_change) on public.memberships to app_user;
-- いまいる人（お店のiPad用の表示専用アカウントは除く）は、次のログインで、パスコードを変えてもらう
update public.memberships set passcode_must_change = true where status = 'active' and not display_only;

create table public.login_events (
  id            bigint generated always as identity primary key,
  company_id    uuid,
  membership_id uuid,
  employee_code text,
  ok            boolean not null,
  reason        text,                       -- ok / invalid / locked / throttled
  ip            text,
  user_agent    text,
  at            timestamptz not null default now()
);
create index on public.login_events (membership_id, at desc);
create index on public.login_events (company_id, at desc);
alter table public.login_events enable row level security;
-- 自分の記録は本人が、会社ぜんぶの記録は管理者が見られる（書き込みは、サーバーだけ）
create policy le_select on public.login_events for select to app_user
  using (company_id = app.my_company_id() and (membership_id = app.uid() or app.my_level() = 4));
grant select on public.login_events to app_user;
