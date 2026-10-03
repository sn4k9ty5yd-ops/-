-- 退職予定日。この日になると、自動で退職（無効）扱いになる（空なら予定なし）。
-- アプリ用ロール(app_user)には列の権限を付けない（管理者の操作はサーバーの管理用接続が行う）。
alter table public.memberships add column retire_on date;
