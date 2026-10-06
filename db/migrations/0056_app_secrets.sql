-- サーバーだけが使う秘密の設定（AIのカギなど）。アプリ用ロールには、一切見せない・触らせない
create table public.app_secrets (
  name        text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from app_user;
