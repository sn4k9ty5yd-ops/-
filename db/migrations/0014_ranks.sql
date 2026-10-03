-- ランク（アシスタント／スタイリスト）と、マニュアルの権限を「ランク」「名前」でも決められるようにする。
-- 今までの「レベル」「お店」「本人」「評価をつけられる人」の決め方は、そのまま使える。
alter table public.memberships add column rank text check (rank in ('assistant', 'stylist'));   -- 空＝決めていない
grant select (rank) on public.memberships to app_user;

alter table public.manual_pages
  add column view_ranks text[] not null default '{}',   -- レベルに関係なく、このランクの人も見られる
  add column edit_ranks text[] not null default '{}';   -- このランクの人も書き込める（見られるページで）
grant update (view_ranks, edit_ranks) on public.manual_pages to app_user;

-- 名前で個別に許可する人（見られる。can_edit なら書き込みも）
create table public.manual_page_grants (
  page_id       uuid not null references public.manual_pages(id) on delete cascade,
  membership_id uuid not null references public.memberships(id),
  can_edit      boolean not null default false,
  primary key (page_id, membership_id)
);
alter table public.manual_page_grants enable row level security;
create policy manual_grants_admin on public.manual_page_grants for all to app_user
  using (app.my_level() >= 4 and exists (select 1 from public.manual_pages p where p.id = page_id and p.company_id = app.my_company_id()))
  with check (app.my_level() >= 4 and exists (select 1 from public.manual_pages p where p.id = page_id and p.company_id = app.my_company_id()));
grant select, insert, update, delete on public.manual_page_grants to app_user;

-- 見られるか（管理者／本人／名前で許可された人／ランクで許可された人／レベルとお店が合う人）
create function app.manual_can_view(pid uuid, c uuid, minl smallint, sid uuid, owner uuid, vranks text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select c = app.my_company_id() and not app.me_display_only() and (
    app.my_level() >= 4 or owner = app.uid()
    or (app.my_level() >= minl and (sid is null or sid = (app.me()).store_id or app.my_level() >= 3))
    or ((app.me()).rank is not null and (app.me()).rank = any(vranks))
    or exists (select 1 from public.manual_page_grants g where g.page_id = pid and g.membership_id = app.uid()))
$$;

drop policy manual_pages_select on public.manual_pages;
create policy manual_pages_select on public.manual_pages for select to app_user
  using (app.manual_can_view(id, company_id, min_level, store_id, owner_id, view_ranks));

-- 書き込めるか（見られるページで）：管理者／レベルが足りて自店／ランク／評価をつけられる人（スタイリストか、名前で指定された人）／名前で書き込みを許可された人
create or replace function app.manual_can_edit(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.manual_pages p
     where p.id = pid and p.company_id = app.my_company_id() and not app.me_display_only()
       and (app.my_level() >= 4
            or (app.manual_can_view(p.id, p.company_id, p.min_level, p.store_id, p.owner_id, p.view_ranks)
                and ((app.my_level() >= p.edit_level and (p.store_id is null or p.store_id = (app.me()).store_id))
                     or ((app.me()).rank is not null and (app.me()).rank = any(p.edit_ranks))
                     or (p.evaluators_edit and ((app.me()).can_evaluate or (app.me()).rank = 'stylist'))
                     or exists (select 1 from public.manual_page_grants g where g.page_id = p.id and g.membership_id = app.uid() and g.can_edit)))))
$$;
