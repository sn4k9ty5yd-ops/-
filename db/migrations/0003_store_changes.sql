-- お店を後から追加したとき、すでにある期間にも「準備中」の進行状況を自動で用意する
create function app.stores_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.store_period_status (period_id, store_id, company_id)
  select p.id, new.id, new.company_id from public.shift_periods p where p.company_id = new.company_id
  on conflict do nothing;
  return new;
end $$;
create trigger stores_after_insert after insert on public.stores
  for each row execute function app.stores_after_insert();
