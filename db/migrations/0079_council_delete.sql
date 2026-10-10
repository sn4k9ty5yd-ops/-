-- AI会議の記録を消せる: 自分がひらいた記録、またはお店の会議をひらける人（店長・正美さんたち）。僕専用は本人だけ
drop policy ac_delete on public.ai_councils;
create policy ac_delete on public.ai_councils for delete to app_user using (
  company_id = app.my_company_id() and (
    (private and created_by = app.uid() and app.is_app_owner())
    or (not private and (created_by = app.uid() or app.meeting_edit(store_id)))));
create policy ma_delete on public.meeting_ai for delete to app_user using (company_id = app.my_company_id() and (created_by = app.uid() or app.meeting_edit(store_id)));
grant delete on public.meeting_ai to app_user;
