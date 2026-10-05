-- 店長は、シフト・休み・出勤簿・有給を、自分の店だけ見られる（他店は見られない）
insert into public.level_permissions (level, permission, scope) values
  (3, 'request.view', 'own'), (3, 'shift.view', 'own'), (3, 'attendance.view', 'own'), (3, 'leave.view', 'own')
on conflict (level, permission) do update set scope = excluded.scope;
