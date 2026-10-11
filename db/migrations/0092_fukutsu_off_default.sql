-- 福津: 六本松と同じ「1日に休める人数」の標準（スタイリスト1人・アシスタント1人〔全体〕）
insert into public.store_off_defaults (store_id, company_id, stylist, assistant)
select id, company_id, 1, 1 from public.stores where name like '%福津%'
on conflict (store_id) do nothing;
