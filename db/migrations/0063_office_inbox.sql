-- スタッフから事務員さん宛ての提出・報告をまとめる「スタッフからの通知」（事務員さん以上だけが見る。アプリ用ロールには見せず、サーバーの関数で渡す）
create table public.office_inbox (
  id         bigserial primary key,
  company_id uuid not null references public.companies(id),
  from_id    uuid,
  from_name  text not null,
  store_name text,
  area       text not null,
  title      text not null,
  link       text not null,
  at         timestamptz not null default now(),
  done_at    timestamptz,
  done_by    text
);
create index on public.office_inbox (company_id, at desc);
revoke all on public.office_inbox from app_user;
