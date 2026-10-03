-- カレンダーに出す短い名前（苗字など）。空なら、名前から自動で決める。
alter table public.memberships add column short_name text;
grant select (short_name) on public.memberships to app_user;
grant update (short_name) on public.memberships to app_user;
