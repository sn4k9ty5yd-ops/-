-- ① 店長(Lv3)も、自店のシフトを「確認済み」にできる（棚卸しの確認は今までどおりオフィスだけ）
insert into public.level_permissions (level, permission, scope) values (3, 'period.acknowledge', 'own'), (4, 'period.acknowledge', 'all')
on conflict do nothing;

-- ② ひとつ戻す: シフト担当(Lv2)・店長・オフィス。「確認済み」から戻せるのは、店長(Lv3)以上
create or replace function app.guard_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare ra int; rb int;
begin
  new.updated_at := now();
  if app.uid() is null then return new; end if;
  new.updated_by := app.uid();
  if tg_op = 'UPDATE' and new.status <> old.status then
    if app.status_rank(new.status) < app.status_rank(old.status) and (app.my_level() < 2 or (app.my_level() < 3 and old.status = 'acknowledged')) then
      raise exception 'cannot move the status backwards';
    end if;
    if new.status = 'acknowledged' and not app.has_perm('period.acknowledge', new.store_id) then
      raise exception 'only the manager or office can acknowledge';
    end if;
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'period.status', new.period_id,
            jsonb_build_object('store', new.store_id, 'from', old.status, 'to', new.status));
  end if;
  if tg_op = 'UPDATE' and new.attendance_status <> old.attendance_status then
    ra := array_position(array['open','submitted','acknowledged'], old.attendance_status);
    rb := array_position(array['open','submitted','acknowledged'], new.attendance_status);
    if rb < ra and (app.my_level() < 2 or (app.my_level() < 4 and old.attendance_status = 'acknowledged')) then raise exception 'only level 4 can move the status backwards'; end if;
    if new.attendance_status = 'acknowledged' and not app.has_perm('shift.acknowledge', new.store_id) then
      raise exception 'only the office can acknowledge';
    end if;
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.company_id, app.uid(), 'attendance.status', new.period_id,
            jsonb_build_object('store', new.store_id, 'from', old.attendance_status, 'to', new.attendance_status));
  end if;
  return new;
end $$;

-- ③ アプリ制作者の行は、本人以外（オフィスでも）変更できない
create function app.guard_owner_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.uid() is not null and old.app_owner and app.uid() <> old.id then
    raise exception 'the app owner cannot be changed by others';
  end if;
  return new;
end $$;
create trigger memberships_owner_guard before update on public.memberships
  for each row execute function app.guard_owner_row();
