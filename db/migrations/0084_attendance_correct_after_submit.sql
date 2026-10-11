-- 出勤簿確定: 提出したあとの「訂正」も、権限のある人（シフト担当・店長・正美さん）ができる。確認済みになったあとは、正美さんが「ひとつ戻す」まで直せない
create or replace function app.attendance_editable(p_period uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_period_status sp
    where sp.period_id = p_period and sp.store_id = p_store
      and sp.attendance_status in ('open', 'submitted')
  )
$$;
