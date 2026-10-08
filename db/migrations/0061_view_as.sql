-- アプリ制作者が、ほかのレベルの見え方で画面を確かめられる（「見え方の切りかえ」）。
-- サーバーが app.view_level などを伝えたとき、本人が app_owner のときだけ、その人のレベル・ランクで判定する。
-- （ほかの人には何も起きない。書き込みも、その見え方の権限のとおりにしかできない）
create or replace function app.me() returns public.memberships
language sql stable security definer set search_path = public as $$
  select case
    when m.app_owner and nullif(current_setting('app.view_level', true), '') is not null
    then jsonb_populate_record(m, jsonb_build_object(
      'level', current_setting('app.view_level')::int,
      'rank', nullif(current_setting('app.view_rank', true), ''),
      'display_only', coalesce(nullif(current_setting('app.view_display', true), ''), 'false')::boolean,
      'exec_view', coalesce(nullif(current_setting('app.view_exec', true), ''), 'false')::boolean,
      'app_owner', false, 'edu_lead', false, 'material_manager', false))
    else m end
  from public.memberships m
  where m.id = app.uid() and m.status = 'active'
    and exists (select 1 from public.companies c where c.id = m.company_id and c.status = 'active')
$$;
