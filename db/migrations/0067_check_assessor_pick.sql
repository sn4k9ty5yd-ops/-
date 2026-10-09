-- 採点者の名前を、自店のスタイリストから選べる（えらばなければ、採点を押した本人）
drop function public.check_attempt_save(uuid, uuid, int, text, text, jsonb);
create function public.check_attempt_save(p_sheet uuid, p_trainee uuid, p_no int, p_time text, p_comment text, p_scores jsonb, p_assessor uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.memberships; asr uuid; tr public.memberships; sh public.check_sheets; aid uuid; tot int := 0; s jsonb; sc int;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into tr from public.memberships where id = p_trainee and company_id = me.company_id and status = 'active';
  select * into sh from public.check_sheets where id = p_sheet and company_id = me.company_id and active;
  if tr.id is null or sh.id is null then raise exception 'forbidden'; end if;
  if not app.can_assess(tr.store_id) then raise exception 'forbidden'; end if;
  if tr.id = me.id then raise exception 'self'; end if;
  asr := me.id;
  if p_assessor is not null and p_assessor <> me.id then
    -- 採点者として名前を入れられるのは、その人のお店のスタイリスト
    if not exists (select 1 from public.memberships where id = p_assessor and company_id = me.company_id and store_id = tr.store_id and status = 'active' and rank = 'stylist') then raise exception 'bad assessor'; end if;
    asr := p_assessor;
  end if;
  if p_no < 1 or p_no > sh.max_attempts then raise exception 'bad no'; end if;
  if jsonb_typeof(p_scores) <> 'array' then raise exception 'bad scores'; end if;
  insert into public.check_attempts (company_id, store_id, sheet_id, trainee_id, attempt_no, assessor_id, time_text, comment)
    values (me.company_id, tr.store_id, sh.id, tr.id, p_no, asr, left(btrim(coalesce(p_time,'')),20), left(coalesce(p_comment,''),1000))
    on conflict (sheet_id, trainee_id, attempt_no) do update set assessor_id = excluded.assessor_id, time_text = excluded.time_text, comment = excluded.comment, updated_at = now()
    returning id into aid;
  delete from public.check_scores where attempt_id = aid;
  for s in select * from jsonb_array_elements(p_scores) loop
    sc := (s->>'score')::int;
    if sc is null or sc < 0 or sc > 5 then raise exception 'bad score'; end if;
    if not exists (select 1 from public.check_items where id = (s->>'itemId')::uuid and sheet_id = sh.id) then raise exception 'bad item'; end if;
    insert into public.check_scores (attempt_id, item_id, score) values (aid, (s->>'itemId')::uuid, sc);
    tot := tot + sc;
  end loop;
  update public.check_attempts set total = tot where id = aid;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (me.company_id, me.id, 'check.attempt_save', aid, jsonb_build_object('trainee', tr.id, 'sheet', sh.id, 'no', p_no, 'total', tot));
  return jsonb_build_object('id', aid, 'total', tot, 'passed', tot >= sh.pass_points, 'store', tr.store_id);
end $$;

grant execute on function public.check_attempt_save(uuid, uuid, int, text, text, jsonb, uuid) to app_user;
