-- ミーティングに種類を足す: ふつう / スタイリストミーティング / アシスタントミーティング
--  スタイリストミーティング: 見る・書く = そのお店のスタイリスト・店長、レベル4以上（全店）
--  アシスタントミーティング: 見る = お店の全員。書く（文字起こし・議事録など）= お店の全員。
--                          「話し合うこと（議題）」を決める・会議をつくる = スタイリスト・店長・レベル4以上
alter table public.meetings add column kind text not null default 'general' check (kind in ('general','stylist','assistant'));
alter table public.meetings add column agenda text not null default '';

create function app.meeting_can(p_store uuid, p_kind text, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and (
    m.level = 4
    or (m.store_id = p_store and (
      case p_mode
        when 'view' then (p_kind <> 'stylist' or m.level >= 3 or m.rank = 'stylist')
        when 'edit' then case p_kind when 'general' then m.level >= 3 when 'stylist' then (m.level >= 3 or m.rank = 'stylist') else true end
        else            case p_kind when 'general' then m.level >= 3 else (m.level >= 3 or m.rank = 'stylist') end
      end))
  ) from app.me() m), false)
$$;
grant execute on function app.meeting_can(uuid, text, text) to app_user;

-- 会議の記録に付いている AI会議の結果も、同じ見える範囲にする
create function app.meeting_ai_can(p_store uuid, p_meeting uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_meeting is null then (case p_mode when 'view' then app.meeting_view(p_store) else app.meeting_edit(p_store) end)
              else coalesce((select app.meeting_can(t.store_id, t.kind, p_mode) from public.meetings t where t.id = p_meeting), false) end
$$;
grant execute on function app.meeting_ai_can(uuid, uuid, text) to app_user;

drop policy mt_select on public.meetings;
drop policy mt_insert on public.meetings;
drop policy mt_update on public.meetings;
create policy mt_select on public.meetings for select to app_user using (company_id = app.my_company_id() and deleted_at is null and app.meeting_can(store_id, kind, 'view'));
create policy mt_insert on public.meetings for insert to app_user with check (company_id = app.my_company_id() and app.meeting_can(store_id, kind, 'agenda'));
create policy mt_update on public.meetings for update to app_user using (company_id = app.my_company_id() and app.meeting_can(store_id, kind, 'edit')) with check (company_id = app.my_company_id() and app.meeting_can(store_id, kind, 'edit'));

drop policy ma_select on public.meeting_ai;
drop policy ma_insert on public.meeting_ai;
create policy ma_select on public.meeting_ai for select to app_user using (company_id = app.my_company_id() and app.meeting_ai_can(store_id, meeting_id, 'view'));
create policy ma_insert on public.meeting_ai for insert to app_user with check (company_id = app.my_company_id() and app.meeting_ai_can(store_id, meeting_id, 'edit'));

-- 「話し合うこと」を書きかえられるのは、決める人だけ（アシスタントは、ほかの項目は書けるが、議題は書けない）
create function app.meeting_agenda_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.agenda is distinct from old.agenda or new.kind is distinct from old.kind) and not app.meeting_can(old.store_id, old.kind, 'agenda') then
    raise exception 'forbidden';
  end if;
  return new;
end $$;
create trigger meetings_agenda_guard before update on public.meetings for each row execute function app.meeting_agenda_guard();
grant update (agenda) on public.meetings to app_user;
