-- 「いまアプリを開いているか」「ログインしたことがあるか」を管理者が見るための記録。
-- アプリ用ロール(app_user)には列の権限を付けない（サーバーの管理用接続だけが読み書きする）。
alter table public.memberships
  add column last_login_at timestamptz,
  add column last_seen_at  timestamptz;
