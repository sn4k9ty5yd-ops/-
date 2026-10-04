-- シフト担当（Lv2）が、自店の出勤簿を見て・入力でき、シフトの進行（受付〜公開）を進められるようにする
insert into public.level_permissions (level, permission, scope) values
  (2, 'attendance.view', 'own'),
  (2, 'attendance.edit', 'own'),
  (2, 'period.manage', 'own')
on conflict do nothing;
