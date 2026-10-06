-- 公開したあとも、シフト担当以上（自店。店長・事務員さんも）は、シフトを直せる（変更があるため）。
-- 確認済み（オフィスの確認が終わったもの）と、準備中は、いままでどおり直せない。変更の履歴は、いままでどおり残る。
create or replace function app.shift_editable(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store
      and (sp.status in ('collecting','closed','drafting','confirmed','published','submitted')
           or (sp.status <> 'acknowledged' and sp.status <> 'preparing' and app.my_level() = 4))
  )
$$;
