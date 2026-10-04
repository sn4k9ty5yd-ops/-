-- 押しまちがえたときに、ひとつ前に戻せる人を広げる: シフト担当(Lv2)・店長(Lv3)も自店で戻せる。
-- ただし「確認済み」から戻せるのはオフィス(Lv4)だけ。
create or replace function app.guard_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare ra int; rb int;
begin
  new.updated_at := now();
  if app.uid() is null then return new; end if;   -- サーバー側の管理処理は対象外
  new.updated_by := app.uid();
  if tg_op = 'UPDATE' and new.status <> old.status then
    if app.status_rank(new.status) < app.status_rank(old.status) and (app.my_level() < 2 or (app.my_level() < 4 and old.status = 'acknowledged')) then
      raise exception 'only level 4 can move the status backwards';
    end if;
    if new.status = 'acknowledged' and not app.has_perm('shift.acknowledge', new.store_id) then
      raise exception 'only the office can acknowledge';
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
