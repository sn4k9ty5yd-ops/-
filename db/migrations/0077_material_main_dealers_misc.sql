-- 材料費: ① 主なディーラー（ダリア・コスモ・キクヤ・FIT・藤井企画）を全店に入れ、先頭に並べる ② カテゴリー「小物」を全業者に足す
-- ③ 髪ドラは FIT の中のカテゴリーにする（過去の発注も FIT／髪ドラ に直す）
-- ④ ミーティングのAI会議は、お店の全員がひらけるようにする

-- ① 主なディーラー
insert into public.material_dealers (company_id, store_id, name, sort_order)
select s.company_id, s.id, d.name, d.ord
  from public.stores s
  cross join (values ('ダリア', 1), ('コスモ', 2), ('キクヤ', 3), ('FIT', 4), ('藤井企画', 5)) as d(name, ord)
 where s.status = 'active'
on conflict (store_id, name) do nothing;
update public.material_dealers
   set sort_order = case name when 'ダリア' then 1 when 'コスモ' then 2 when 'キクヤ' then 3 when 'FIT' then 4 when '藤井企画' then 5 else sort_order + 10 end;

-- ③ 髪ドラ → FIT の中のカテゴリー
insert into public.material_categories (company_id, store_id, dealer_id, name, sort_order)
select k.company_id, k.store_id, f.id, '髪ドラ', 6
  from public.material_dealers k
  join public.material_dealers f on f.store_id = k.store_id and f.name = 'FIT'
 where k.name in ('髪ドラ', '髪どら')
   and not exists (select 1 from public.material_categories x where x.dealer_id = f.id and x.name = '髪ドラ');
update public.material_orders
   set supplier = 'FIT', category = case when category = '' then '髪ドラ' else category end
 where supplier in ('髪ドラ', '髪どら');
delete from public.material_categories where dealer_id in (select id from public.material_dealers where name in ('髪ドラ', '髪どら'));
delete from public.material_dealers where name in ('髪ドラ', '髪どら');

-- ② 全業者に、はじめのカテゴリー（カラー・ストレート・パーマ・小物・その他）が揃うようにする
insert into public.material_categories (company_id, store_id, dealer_id, name, sort_order)
select d.company_id, d.store_id, d.id, c.name, c.ord
  from public.material_dealers d
  cross join (values ('カラー', 1), ('ストレート', 2), ('パーマ', 3), ('小物', 4), ('その他', 5)) as c(name, ord)
 where not exists (select 1 from public.material_categories x where x.dealer_id = d.id and x.name = c.name);
update public.material_categories set sort_order = 4 where name = '小物';
update public.material_categories set sort_order = 5 where name = 'その他';

-- ④ AI会議（ミーティング）: お店の全員が、ひらける・読める。「僕専用」は今までどおり本人だけ
drop policy ac_insert on public.ai_councils;
create policy ac_insert on public.ai_councils for insert to app_user with check (
  company_id = app.my_company_id() and created_by = app.uid() and (
    (not private and app.meeting_view(store_id))
    or (private and app.is_app_owner())));
