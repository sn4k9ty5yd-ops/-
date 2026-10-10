-- 初期セットの「シャンプー・トリートメント」をやめる。使われていないものは消し、発注で使われているものは「しまう」だけにする
delete from public.material_categories c
 where c.name = 'シャンプー・トリートメント'
   and not exists (select 1 from public.material_orders o
                    join public.material_dealers d on d.id = c.dealer_id
                   where o.store_id = c.store_id and o.supplier = d.name and o.category = c.name);
update public.material_categories c set active = false where c.name = 'シャンプー・トリートメント';
