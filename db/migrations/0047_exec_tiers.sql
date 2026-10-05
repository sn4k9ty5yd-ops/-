-- レベル6=アプリ制作者(app_ownerの人)・レベル5=事務員さん・レベル4=社長（見るだけ）
-- 中のレベルの数字は、これまでの「4=オフィス」のまま。社長だけ exec_view=true の印をつけ、書き込みはできないようにする（アプリ側で止める）
alter table public.memberships add column exec_view boolean not null default false;
grant select (exec_view) on public.memberships to app_user;

create function app.me_exec_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.exec_view from app.me() m), false)
$$;
grant execute on function app.me_exec_view() to app_user;

-- レッスンの状況（記録・採点）は、事務員さんには見せない（制作者と社長は見られる）
create or replace function app.is_edu(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (m.level = 4 and (m.app_owner or m.exec_view)) or (m.level = 3 and m.store_id = p_store) or (m.edu_lead and m.store_id = p_store)
                     from app.me() m where not m.display_only), false)
$$;
create or replace function app.can_assess(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and ((m.level = 4 and (m.app_owner or m.exec_view)) or (m.store_id = p_store and (m.level >= 3 or m.can_evaluate or m.edu_lead or m.rank = 'stylist'))) from app.me() m), false)
$$;
create or replace function app.can_edit_checks() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and ((m.level = 4 and (m.app_owner or m.exec_view)) or m.edu_lead) from app.me() m), false)
$$;

-- 鬼塚さん（社長）を、レベル4（見るだけ）にする。アプリ制作者の人は対象外
update public.memberships set exec_view = true where level = 4 and not app_owner and status = 'active' and name like '鬼塚%';
