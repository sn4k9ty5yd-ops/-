-- レッスンチェックを採点できる人に、自店のスタイリスト（ランク＝スタイリスト）も加える
create or replace function app.can_assess(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and (m.level = 4 or (m.store_id = p_store and (m.level >= 3 or m.can_evaluate or m.edu_lead or m.rank = 'stylist'))) from app.me() m), false)
$$;
