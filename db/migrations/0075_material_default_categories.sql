-- 材料費: 業者ごとに、はじめのカテゴリーを入れておく（店長が「しまう」「名前を直す」「足す」で変えられる）
insert into public.material_categories (company_id, store_id, dealer_id, name, sort_order)
select d.company_id, d.store_id, d.id, c.name, c.ord
  from public.material_dealers d
  cross join (values ('カラー', 1), ('ストレート', 2), ('パーマ', 3), ('シャンプー・トリートメント', 4), ('その他', 5)) as c(name, ord)
 where not exists (select 1 from public.material_categories x where x.dealer_id = d.id and x.name = c.name);
