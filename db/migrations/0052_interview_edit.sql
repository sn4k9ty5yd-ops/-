-- 面談シート: まちがえたときに、書いた人が「削除」と「提出の取り下げ（直せる状態にもどす）」をできる。店長が確認ずみのものは、動かせない
create function public.interview_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare iv public.interviews;
begin
  select * into iv from public.interviews where id = p_id and company_id = app.my_company_id();
  if iv.id is null or iv.author_id <> app.uid() or iv.status = 'reviewed' then raise exception 'forbidden'; end if;
  delete from public.interviews where id = p_id;
  return true;
end $$;
create function public.interview_reopen(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare iv public.interviews;
begin
  select * into iv from public.interviews where id = p_id and company_id = app.my_company_id();
  if iv.id is null or iv.author_id <> app.uid() or iv.status <> 'submitted' then raise exception 'forbidden'; end if;
  update public.interviews set status = 'draft', submitted_at = null, updated_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.interview_delete(uuid), public.interview_reopen(uuid) from public;
grant execute on function public.interview_delete(uuid), public.interview_reopen(uuid) to app_user;
