-- アシスタントの「1年目／2年目」。シフトの名前の色分けなどに使う（正美さんが決める）
alter table public.memberships add column assistant_year smallint check (assistant_year in (1, 2));
grant select (assistant_year) on public.memberships to app_user;
