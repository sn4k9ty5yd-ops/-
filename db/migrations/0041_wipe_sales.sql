-- 個人の売上の数字は、報告のしかたが決まるまで使わないので、入っていた数字を消す（情報がもれないように）
delete from public.sales_images;
delete from public.sales_targets;
delete from public.sales_stats;
delete from public.sales_reminder_log;
delete from public.notifications where link in ('/sales', '/my-sales');
