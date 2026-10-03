-- マニュアル（Notionなどから取り込んだ、文章・画像・動画・表・トグルを見るための場所）。
-- ページごとに「見られる人」「書き込める人」を決める。決めるのは管理者(レベル4)だけ。
-- 「技術評価をつける人（スタイリスト）」はスタッフごとの印（can_evaluate）で表す。
insert into public.level_permissions (level, permission, scope) values (4, 'manual.manage', 'all');

alter table public.memberships add column can_evaluate boolean not null default false;   -- 技術評価をつけられる人（管理者が決める）
grant select (can_evaluate) on public.memberships to app_user;

create table public.manual_pages (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  parent_id  uuid,
  title      text not null check (length(trim(title)) > 0),
  icon       text not null default '',
  body       jsonb not null default '[]',        -- ブロックの並び（lib/manual/blocks.ts）
  sort_order int  not null default 0,
  min_level  smallint not null default 1 check (min_level between 1 and 4),   -- このレベル以上の人が見られる
  edit_level smallint not null default 4 check (edit_level between 1 and 4),  -- このレベル以上の人が書き込める
  store_id   uuid,                                -- 入れると、そのお店の人（と店長以上）だけが見られる／書き込める
  owner_id   uuid references public.memberships(id),   -- そのページの本人（見られる）。例: スタッフ個人の評価ページ
  evaluators_edit boolean not null default false, -- 「評価をつけられる人」も書き込める
  source_id  text,                                -- 取り込み元（Notion）のID。取り込み直しで同じページを更新するため
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, source_id),
  foreign key (parent_id, company_id) references public.manual_pages (id, company_id) on delete cascade,
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.manual_pages (company_id, parent_id, sort_order);

-- 画像・PDFなど（中身はデータベースに保存。同じファイルは1つだけ）
create table public.manual_assets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null default '',
  mime       text not null,
  size       int  not null,
  sha        text not null,
  min_level  smallint not null default 1,
  data       bytea not null,
  created_at timestamptz not null default now(),
  unique (company_id, sha)
);

-- 書き込みの記録（だれが・いつ）
create table public.manual_edit_log (
  id         bigint generated always as identity primary key,
  company_id uuid not null,
  page_id    uuid not null references public.manual_pages(id) on delete cascade,
  user_id    uuid,
  summary    text not null,
  at         timestamptz not null default now()
);
create index on public.manual_edit_log (page_id, at desc);

-- 見られるか：管理者／本人／（レベルが足りていて、お店が合う人。店長以上は他店も見られる）
create function app.manual_view_ok(c uuid, minl smallint, sid uuid, owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c = app.my_company_id() and not app.me_display_only() and (
    app.my_level() >= 4 or owner = app.uid()
    or (app.my_level() >= minl and (sid is null or sid = (app.me()).store_id or app.my_level() >= 3)))
$$;

-- 書き込めるか：管理者／レベルが足りていて自店のページ／「評価をつけられる人」で、書き込みを許したページ
create function app.manual_can_edit(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.manual_pages p
     where p.id = pid and p.company_id = app.my_company_id() and not app.me_display_only()
       and (app.my_level() >= 4
            or (app.my_level() >= p.edit_level and (p.store_id is null or p.store_id = (app.me()).store_id))
            or (p.evaluators_edit and (app.me()).can_evaluate
                and app.manual_view_ok(p.company_id, p.min_level, p.store_id, p.owner_id))))
$$;

-- 中身の書き込み（権限を確かめて、記録も残す）
create function app.manual_write_body(pid uuid, nb jsonb, summary text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.manual_can_edit(pid) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.manual_pages set body = nb, updated_at = now() where id = pid;
  insert into public.manual_edit_log (company_id, page_id, user_id, summary)
    select company_id, id, app.uid(), summary from public.manual_pages where id = pid;
end $$;

alter table public.manual_pages    enable row level security;
alter table public.manual_assets   enable row level security;
alter table public.manual_edit_log enable row level security;

create policy manual_pages_select on public.manual_pages for select to app_user
  using (app.manual_view_ok(company_id, min_level, store_id, owner_id));
create policy manual_pages_insert on public.manual_pages for insert to app_user
  with check (company_id = app.my_company_id() and app.my_level() >= 4);
create policy manual_pages_update on public.manual_pages for update to app_user
  using (company_id = app.my_company_id() and app.my_level() >= 4)
  with check (company_id = app.my_company_id() and app.my_level() >= 4);
create policy manual_pages_delete on public.manual_pages for delete to app_user
  using (company_id = app.my_company_id() and app.my_level() >= 4);
create policy manual_assets_select on public.manual_assets for select to app_user
  using (app.manual_view_ok(company_id, min_level, null, null));
create policy manual_log_select on public.manual_edit_log for select to app_user
  using (app.manual_can_edit(page_id));

grant select, insert, delete on public.manual_pages to app_user;
grant update (parent_id, title, icon, sort_order, min_level, edit_level, store_id, owner_id, evaluators_edit, updated_at) on public.manual_pages to app_user;
grant select (id, company_id, name, mime, size, min_level, data) on public.manual_assets to app_user;
grant select on public.manual_edit_log to app_user;
