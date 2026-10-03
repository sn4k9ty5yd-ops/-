-- レッスン記録: 教育担当が、毎日「だれが何をしたか」をボタンで記録する。事務員さんへの連絡（メモ）をアプリの中で完結させる。
alter table public.memberships add column edu_lead boolean not null default false;   -- 教育担当（店長か管理者が決める）
grant select (edu_lead) on public.memberships to app_user;

-- 記録・ボタンを編集できる人: 管理者(全店)・店長(自店)・教育担当(自店)
create function app.is_edu(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (m.level = 4) or (m.level = 3 and m.store_id = p_store) or (m.edu_lead and m.store_id = p_store)
                     from app.me() m where not m.display_only), false)
$$;
grant execute on function app.is_edu(uuid) to app_user;

create table public.lesson_categories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id   uuid not null,
  name       text not null check (length(btrim(name)) between 1 and 30),
  sort_order int  not null default 0,
  active     boolean not null default true,     -- 使わなくなったボタンは消さずに「しまう」（過去の記録が残る）
  created_at timestamptz not null default now(),
  unique (id, store_id),
  unique (store_id, name),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create table public.lesson_logs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  store_id     uuid not null,
  assistant_id uuid not null references public.memberships(id),
  category_id  uuid not null,
  day          date not null,
  minutes      int check (minutes is null or (minutes between 1 and 600)),   -- かかった時間（任意）
  note         text not null default '' check (length(note) <= 300),
  created_by   uuid not null references public.memberships(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid,
  foreign key (category_id, store_id) references public.lesson_categories (id, store_id),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.lesson_logs (assistant_id, day);
create index on public.lesson_logs (store_id, day);

alter table public.lesson_categories enable row level security;
alter table public.lesson_logs       enable row level security;
create policy lc_select on public.lesson_categories for select to app_user
  using (company_id = app.my_company_id() and (app.my_level() >= 3 or store_id = (app.me()).store_id));
create policy lc_insert on public.lesson_categories for insert to app_user
  with check (company_id = app.my_company_id() and app.is_edu(store_id));
create policy lc_update on public.lesson_categories for update to app_user
  using (company_id = app.my_company_id() and app.is_edu(store_id)) with check (company_id = app.my_company_id() and app.is_edu(store_id));
-- 自分の記録は本人が見られる。店ぜんぶの記録は、管理者・店長・教育担当
create policy ll_select on public.lesson_logs for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only()
         and ((assistant_id = app.uid() and deleted_at is null) or app.is_edu(store_id)));
create policy ll_insert on public.lesson_logs for insert to app_user
  with check (company_id = app.my_company_id() and app.is_edu(store_id) and created_by = app.uid()
              and exists (select 1 from public.memberships a where a.id = assistant_id and a.store_id = lesson_logs.store_id));
create policy ll_update on public.lesson_logs for update to app_user
  using (company_id = app.my_company_id() and app.is_edu(store_id)) with check (company_id = app.my_company_id() and app.is_edu(store_id));
grant select, insert on public.lesson_categories to app_user;
grant update (name, sort_order, active) on public.lesson_categories to app_user;
grant select, insert on public.lesson_logs to app_user;
grant update (category_id, day, minutes, note, deleted_at, deleted_by) on public.lesson_logs to app_user;

-- 初期のボタン（お店ごとに、あとから編集できる）
insert into public.lesson_categories (company_id, store_id, name, sort_order)
select s.company_id, s.id, c.name, c.ord from public.stores s
  cross join (values ('カットモデル', 1), ('ウィッグカット', 2), ('カラー', 3), ('パーマ', 4), ('髪質改善', 5), ('シャンプー', 6)) as c(name, ord);
