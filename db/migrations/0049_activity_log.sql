-- 変更の記録: だれが・どこを・いつ、変更したか（アプリ制作者だけが見られる。アプリ用ロールには一切見せない）
create table public.activity_log (
  id         bigserial primary key,
  company_id uuid not null references public.companies(id),
  user_id    uuid,
  user_name  text not null,
  user_level text not null,
  store_name text,
  area       text not null,        -- どこ（シフト・出勤簿・棚卸し…）
  what       text not null,        -- なにをした（保存・提出・取り消し…）
  path       text not null,
  at         timestamptz not null default now()
);
create index on public.activity_log (company_id, at desc);
revoke all on public.activity_log from app_user;
