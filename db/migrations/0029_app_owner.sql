-- アプリ制作者（最高ランク）の印。アプリの画面からは変えられない（列の更新権限を付けない）。
alter table public.memberships add column app_owner boolean not null default false;
grant select (app_owner) on public.memberships to app_user;
-- 最初の設定: 成田 和樹さんの有効なアカウントに付ける
update public.memberships set app_owner = true
 where status = 'active' and replace(replace(name, ' ', ''), '　', '') = '成田和樹';
