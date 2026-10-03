-- 休憩・実働のルール（会社の設定。オフィスがいつでも変更できる）
--  work_cap_minutes: 実働の上限（分）。在店がこれを超えた分は休憩とみなす。NULL なら上限なし
--  break_tiers: [{"overMinutes":360,"breakMinutes":45}, ...] 在店が overMinutes を超えたら、最低 breakMinutes を休憩にする
-- 初期値: 上限8時間・段階なし（＝8時間以内は休憩なし）
alter table public.companies
  add column work_cap_minutes int default 480 check (work_cap_minutes is null or work_cap_minutes between 60 and 1440),
  add column break_tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(break_tiers) = 'array');

insert into public.level_permissions (level, permission, scope) values (4, 'company.settings', 'all');

create policy companies_update on public.companies
  for update to app_user
  using (id = app.my_company_id() and app.has_perm('company.settings', (app.me()).store_id))
  with check (id = app.my_company_id() and app.has_perm('company.settings', (app.me()).store_id));
grant update (work_cap_minutes, break_tiers) on public.companies to app_user;

create function app.audit_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.work_cap_minutes is distinct from old.work_cap_minutes or new.break_tiers is distinct from old.break_tiers then
    insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (new.id, app.uid(), 'company.break_rule', new.id,
            jsonb_build_object('before', jsonb_build_object('cap', old.work_cap_minutes, 'tiers', old.break_tiers),
                               'after',  jsonb_build_object('cap', new.work_cap_minutes, 'tiers', new.break_tiers)));
  end if;
  return new;
end $$;
create trigger companies_audit after update on public.companies
  for each row execute function app.audit_company();
