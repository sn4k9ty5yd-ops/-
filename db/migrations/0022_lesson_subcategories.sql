-- レッスンのボタンに「小さなボタン」（ウィッグカットの中のワンレングス・グラデーション・レイヤー、など）。1段だけ。
alter table public.lesson_categories add column parent_id uuid references public.lesson_categories(id);
alter table public.lesson_categories drop constraint lesson_categories_store_id_name_key;
create unique index lesson_categories_name_uq on public.lesson_categories (store_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
grant update (parent_id) on public.lesson_categories to app_user;

-- 初期の小さなボタン（マニュアルを参考。お店ごとに、あとから編集できる）
insert into public.lesson_categories (company_id, store_id, name, sort_order, parent_id)
select p.company_id, p.store_id, c.name, c.ord, p.id from public.lesson_categories p
  join (values ('ウィッグカット', 'ワンレングス', 1), ('ウィッグカット', 'グラデーション', 2), ('ウィッグカット', 'レイヤー', 3),
               ('カラー', 'ファッションカラー', 1), ('カラー', 'グレイカラー（リタッチ）', 2)) as c(parent, name, ord) on c.parent = p.name
 where p.parent_id is null;
