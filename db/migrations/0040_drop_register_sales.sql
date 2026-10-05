-- 店舗のレジ売上の表（数字・スタッフ名つき）は使わないので、データごと消す（情報がもれないように）
drop function if exists public.register_save(uuid, date, int, jsonb);
drop function if exists public.register_confirm(uuid, date, boolean);
drop table if exists public.register_sales;
drop table if exists public.register_sales_status;
delete from public.notifications where kind = 'register';
