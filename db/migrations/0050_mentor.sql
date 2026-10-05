-- メンター（悩み相談のチャット）と、面談シート
-- チャット: 会話は本人だけが読める（ほかのレベルの人・事務員さん・社長・店長も読めない）。DBの権限で守る
-- 面談シート: 書いた人と、そのお店の店長だけが読める

create table public.mentor_profiles (
  membership_id uuid primary key references public.memberships(id),
  company_id    uuid not null references public.companies(id),
  mbti          text check (mbti is null or mbti ~ '^[EI][NS][TF][JP]$'),
  updated_at    timestamptz not null default now()
);
create table public.mentor_messages (
  id            bigserial primary key,
  company_id    uuid not null references public.companies(id),
  membership_id uuid not null references public.memberships(id),
  session_id    uuid not null,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null check (length(content) between 1 and 20000),
  created_at    timestamptz not null default now()
);
create index on public.mentor_messages (membership_id, session_id, id);

alter table public.mentor_profiles enable row level security;
alter table public.mentor_messages enable row level security;
create policy mp_all on public.mentor_profiles for all to app_user
  using (membership_id = app.uid() and company_id = app.my_company_id() and not app.me_display_only())
  with check (membership_id = app.uid() and company_id = app.my_company_id() and not app.me_display_only());
create policy mm_select on public.mentor_messages for select to app_user using (membership_id = app.uid() and company_id = app.my_company_id());
create policy mm_insert on public.mentor_messages for insert to app_user with check (membership_id = app.uid() and company_id = app.my_company_id() and not app.me_display_only());
create policy mm_delete on public.mentor_messages for delete to app_user using (membership_id = app.uid() and company_id = app.my_company_id());
grant select, insert, update on public.mentor_profiles to app_user;
grant select, insert, delete on public.mentor_messages to app_user;
grant usage, select on sequence public.mentor_messages_id_seq to app_user;

-- 面談シート
create table public.interviews (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  store_id     uuid not null,
  mentee_id    uuid not null references public.memberships(id),    -- 面談を受けた人
  author_id    uuid not null references public.memberships(id),    -- 面談をした人（メンター）
  template     text not null,                                      -- 4月・6月・10月・2月 など
  held_on      date not null,
  answers      jsonb not null default '{}'::jsonb,                 -- 質問 → 答え
  memo         text not null default '',
  status       text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed')),
  submitted_at timestamptz,
  review_comment text not null default '',
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id)
);
create index on public.interviews (store_id, held_on desc);

create function app.interview_manager(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and m.level = 3 and m.store_id = p_store from app.me() m), false)
$$;
grant execute on function app.interview_manager(uuid) to app_user;

alter table public.interviews enable row level security;
-- 読める人: 書いた人本人と、そのお店の店長だけ
create policy iv_select on public.interviews for select to app_user
  using (company_id = app.my_company_id() and (author_id = app.uid() or app.interview_manager(store_id)));
-- 書く人: 自分のお店の人が、自分名義で（下書きのうちだけ直せる）
create policy iv_insert on public.interviews for insert to app_user
  with check (company_id = app.my_company_id() and author_id = app.uid() and status = 'draft'
              and store_id = (select m.store_id from app.me() m) and not app.me_display_only());
create policy iv_update on public.interviews for update to app_user
  using (company_id = app.my_company_id() and author_id = app.uid() and status = 'draft')
  with check (company_id = app.my_company_id() and author_id = app.uid() and status in ('draft', 'submitted'));
grant select, insert, update on public.interviews to app_user;

-- 店長の確認（コメントをつけて「確認済み」にする）
create function public.interview_review(p_id uuid, p_comment text) returns boolean
language plpgsql security definer set search_path = public as $$
declare iv public.interviews; me public.memberships;
begin
  select * into me from app.me();
  select * into iv from public.interviews where id = p_id and company_id = me.company_id;
  if iv.id is null or not app.interview_manager(iv.store_id) then raise exception 'forbidden'; end if;
  if iv.status = 'draft' then raise exception 'not submitted'; end if;
  update public.interviews set status = 'reviewed', review_comment = left(coalesce(p_comment, ''), 2000), reviewed_by = me.id, reviewed_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.interview_review(uuid, text) from public;
grant execute on function public.interview_review(uuid, text) to app_user;
