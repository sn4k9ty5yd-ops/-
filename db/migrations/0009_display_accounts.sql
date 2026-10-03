-- お店のiPadなどの「表示専用アカウント」。見るだけ（今日の出勤・シフト・みんなの休み）。
-- 希望休は出せない。シフト・出勤簿には載らない。作れるのは管理者(レベル4)だけ。
alter table public.memberships
  add column display_only boolean not null default false,
  add constraint display_only_is_level1 check (not display_only or level = 1),
  add constraint display_only_not_on_shift check (not (display_only and on_shift));

grant select (display_only), insert (display_only) on public.memberships to app_user;

create or replace function app.guard_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- ログイン中の人が操作する場合のみ検査（初期登録などサーバー側の管理処理は対象外）
  if app.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.company_id <> old.company_id then
    raise exception 'company_id cannot be changed';
  end if;
  if (tg_op = 'INSERT' and new.level <> 1) or (tg_op = 'UPDATE' and new.level <> old.level) then
    if not app.has_perm('level.assign', new.store_id) then
      raise exception 'only level 4 can assign levels';
    end if;
  end if;
  if tg_op = 'INSERT' and new.display_only then
    if not app.has_perm('level.assign', new.store_id) then
      raise exception 'only level 4 can create display-only accounts';
    end if;
  end if;
  return new;
end $$;

-- 表示専用アカウントは、希望休を出せない
create function app.me_display_only() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce((app.me()).display_only, false) $$;

drop policy tor_insert on public.time_off_requests;
create policy tor_insert on public.time_off_requests
  for insert to app_user
  with check (company_id = app.my_company_id() and (
    (membership_id = app.uid() and kind in ('hope','paid') and app.request_window_open(period_id, store_id) and not app.me_display_only())
    or app.has_perm('request.manage', store_id)));
