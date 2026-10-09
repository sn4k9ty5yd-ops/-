-- AI会議（課題を入れると、AIが会議してくれる）を、議事録（ミーティング）から分ける
-- ふつうのAI会議: 自分のお店の人は見られる。つくれる人は店長(自店)・正美さん以上（議事録と同じ）
-- 僕専用のAI会議（private）: アプリ制作者の本人だけが読み書きできる（ほかの人は、鬼塚さん・正美さんも見えない）
create table public.ai_councils (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  store_id    uuid,
  private     boolean not null default false,
  theme       text not null check (length(trim(theme)) > 0),
  result      text not null,
  created_by  uuid not null references public.memberships(id),
  created_at  timestamptz not null default now(),
  check ((private and store_id is null) or (not private and store_id is not null)),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.ai_councils (store_id, created_at desc);
create index on public.ai_councils (created_by, created_at desc) where private;

alter table public.ai_councils enable row level security;
create policy ac_select on public.ai_councils for select to app_user using (
  company_id = app.my_company_id() and (
    (not private and app.meeting_view(store_id))
    or (private and created_by = app.uid() and app.is_app_owner())));
create policy ac_insert on public.ai_councils for insert to app_user with check (
  company_id = app.my_company_id() and created_by = app.uid() and (
    (not private and app.meeting_edit(store_id))
    or (private and app.is_app_owner())));
create policy ac_delete on public.ai_councils for delete to app_user using (
  company_id = app.my_company_id() and created_by = app.uid() and (private = false or app.is_app_owner()));
grant select, insert, delete on public.ai_councils to app_user;
