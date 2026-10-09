-- 毎朝の占い通知: 誕生日（月と日だけ・年は聞かない）と、受け取る／受け取らない。本人だけが読み書きできる（mentor_profiles の既存の権限）
alter table public.mentor_profiles
  add column birth_month smallint check (birth_month is null or birth_month between 1 and 12),
  add column birth_day smallint check (birth_day is null or birth_day between 1 and 31),
  add column fortune_push boolean not null default false;
grant update (birth_month, birth_day, fortune_push) on public.mentor_profiles to app_user;
