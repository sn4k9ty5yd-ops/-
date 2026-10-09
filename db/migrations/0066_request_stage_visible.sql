-- 希望休の段階から、お店の全員（アシスタント含む）が、みんなの希望休とシフトを「見るだけ」できる。
-- 直せるのは、これまでどおり、シフト担当・店長・事務員さんだけ。
insert into public.level_permissions (level, permission, scope) values (1, 'request.view', 'own')
on conflict (level, permission) do update set scope = excluded.scope;

-- 「見せてよい段階」: 希望休の受付中(collecting)以降。準備中はまだ見せない
create or replace function app.is_published(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store
      and app.status_rank(sp.status) >= app.status_rank('collecting')
  )
$$;
