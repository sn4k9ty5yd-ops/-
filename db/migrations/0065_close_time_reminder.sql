-- 毎日の退店時間の登録: 「この日は登録した」の印と、お知らせを送った記録（アプリ用ロールには見せず、サーバーの関数から使う）
create table public.attendance_day_confirm (
  store_id     uuid not null references public.stores(id),
  day          date not null,
  company_id   uuid not null references public.companies(id),
  confirmed_by uuid,
  confirmed_at timestamptz not null default now(),
  primary key (store_id, day)
);
create table public.attendance_reminder_log (
  store_id uuid not null references public.stores(id),
  day      date not null,
  sent_at  timestamptz not null default now(),
  primary key (store_id, day)
);
revoke all on public.attendance_day_confirm, public.attendance_reminder_log from app_user;
