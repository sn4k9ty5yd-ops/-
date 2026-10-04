-- 棚卸しは、お店のみんなでやる。一般のスタッフ(Lv1)も、自店の棚卸しを見られて、数量を入れられる。
-- （棚卸しを始める・提出する・商品の追加は、今までどおり店長以上）
insert into public.level_permissions (level, permission, scope) values
  (1, 'stocktake.view', 'own'), (1, 'stocktake.edit', 'own')
on conflict do nothing;
