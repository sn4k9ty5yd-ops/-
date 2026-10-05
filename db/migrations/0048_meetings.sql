-- ミーティング（議事録）: 文字起こし・議事録・要約・マインドマップ・AI会議の結果を、お店ごとに残す
-- 見られる人: 自店の人（スタッフ全員）・レベル4以上は全店。書ける人: 店長(自店)・レベル4以上
create table public.meetings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  store_id    uuid not null,
  title       text not null check (length(trim(title)) > 0),
  held_on     date not null,
  attendees   text not null default '',
  transcript  text not null default '',     -- 文字起こし
  minutes     text not null default '',     -- 議事録
  summary     text not null default '',     -- 要約
  mindmap     text not null default '',     -- マインドマップ（JSONの文字）
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.meetings (store_id, held_on desc);

-- AI会議（テーマを入れると、3人の人格が5回会話して、結論と行動計画を出す）の結果
create table public.meeting_ai (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  store_id    uuid not null,
  meeting_id  uuid references public.meetings(id),
  theme       text not null,
  result      text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.meeting_ai (store_id, created_at desc);

create function app.meeting_view(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and (m.level = 4 or m.store_id = p_store) from app.me() m), false)
$$;
create function app.meeting_edit(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and (m.level = 4 or (m.level = 3 and m.store_id = p_store)) from app.me() m), false)
$$;
grant execute on function app.meeting_view(uuid), app.meeting_edit(uuid) to app_user;

alter table public.meetings   enable row level security;
alter table public.meeting_ai enable row level security;
create policy mt_select on public.meetings for select to app_user using (company_id = app.my_company_id() and deleted_at is null and app.meeting_view(store_id));
create policy mt_insert on public.meetings for insert to app_user with check (company_id = app.my_company_id() and app.meeting_edit(store_id));
create policy mt_update on public.meetings for update to app_user using (company_id = app.my_company_id() and app.meeting_edit(store_id)) with check (company_id = app.my_company_id() and app.meeting_edit(store_id));
create policy ma_select on public.meeting_ai for select to app_user using (company_id = app.my_company_id() and app.meeting_view(store_id));
create policy ma_insert on public.meeting_ai for insert to app_user with check (company_id = app.my_company_id() and app.meeting_edit(store_id));
grant select, insert, update on public.meetings to app_user;

-- 削除は、消さずに隠す（更新のあとは「見える行」でなくなるので、関数で行う）
create function public.meeting_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.meetings;
begin
  select * into m from public.meetings where id = p_id and deleted_at is null and company_id = app.my_company_id();
  if m.id is null or not app.meeting_edit(m.store_id) then raise exception 'forbidden'; end if;
  update public.meetings set deleted_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.meeting_delete(uuid) from public;
grant execute on function public.meeting_delete(uuid) to app_user;
grant select, insert on public.meeting_ai to app_user;
