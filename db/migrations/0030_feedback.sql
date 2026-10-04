-- 「こうしてほしい」のご要望。だれでも書ける。見られるのは、書いた本人と、アプリ制作者(app_owner)だけ。
create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  from_id    uuid not null references public.memberships(id),
  body       text not null check (length(body) between 1 and 2000),
  status     text not null default 'new' check (status in ('new','read','done')),
  reply      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.feedback (company_id, created_at desc);
alter table public.feedback enable row level security;
create function app.is_app_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((app.me()).app_owner, false)
$$;
grant execute on function app.is_app_owner() to app_user;
create policy fb_select on public.feedback for select to app_user
  using (company_id = app.my_company_id() and (from_id = app.uid() or app.is_app_owner()));
create policy fb_insert on public.feedback for insert to app_user
  with check (company_id = app.my_company_id() and from_id = app.uid() and not app.me_display_only());
create policy fb_update on public.feedback for update to app_user
  using (company_id = app.my_company_id() and app.is_app_owner())
  with check (company_id = app.my_company_id() and app.is_app_owner());
grant select on public.feedback to app_user;
grant insert (company_id, from_id, body) on public.feedback to app_user;
grant update (status, reply, updated_at) on public.feedback to app_user;
