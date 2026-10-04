-- 棚卸しは、お店のみんなが、始める・提出する・数量を書ける（自店だけ）。確認済みにするのは、今までどおり事務員さんだけ。
insert into public.level_permissions (level, permission, scope) values
  (1, 'stocktake.manage', 'own'), (2, 'stocktake.manage', 'own'), (1, 'product.view', 'own')
on conflict do nothing;

-- 棚卸しを始めるときに、商品の一覧を読めるように（一般のスタッフも、自店の商品を見られる）
drop policy products_select on public.products;
create policy products_select on public.products
  for select to app_user using (company_id = app.my_company_id() and (
    app.my_level() >= 3 or exists (select 1 from public.product_stores ps where ps.product_id = id and ps.store_id = (app.me()).store_id)) and app.my_level() >= 1);
