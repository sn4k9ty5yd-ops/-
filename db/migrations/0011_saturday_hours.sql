-- 土曜日だけ営業時間が違うお店のための設定（空なら平日と同じ）。
alter table public.stores
  add column sat_open  time,
  add column sat_close time,
  add constraint sat_hours_pair check ((sat_open is null) = (sat_close is null) and (sat_open is null or sat_close > sat_open));
grant update (sat_open, sat_close) on public.stores to app_user;
