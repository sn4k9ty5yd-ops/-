-- アシスタントミーティング: 「次のミーティングの議題」を、スタイリストがいつでも書ける掲示板（お店に1つ）。
-- アシスタントは見て、会議の記録（報告）を自分でつくって書ける。
create table public.meeting_next_agenda (
  company_id uuid not null references public.companies(id),
  store_id uuid not null references public.stores(id),
  body text not null default '',
  updated_by uuid references public.memberships(id),
  updated_at timestamptz not null default now(),
  primary key (store_id)
);
alter table public.meeting_next_agenda enable row level security;
alter table public.meeting_next_agenda force row level security;
create policy mna_select on public.meeting_next_agenda for select to app_user using (company_id = app.my_company_id() and app.meeting_can(store_id, 'assistant', 'view'));
create policy mna_insert on public.meeting_next_agenda for insert to app_user with check (company_id = app.my_company_id() and app.meeting_can(store_id, 'assistant', 'agenda'));
create policy mna_update on public.meeting_next_agenda for update to app_user using (company_id = app.my_company_id() and app.meeting_can(store_id, 'assistant', 'agenda')) with check (company_id = app.my_company_id() and app.meeting_can(store_id, 'assistant', 'agenda'));
grant select, insert, update on public.meeting_next_agenda to app_user;

-- アシスタントミーティングの記録（報告）は、お店のだれでも自分でつくれる（議題は書きかえられない＝今までの見張りのまま）
drop policy mt_insert on public.meetings;
create policy mt_insert on public.meetings for insert to app_user with check (company_id = app.my_company_id() and app.meeting_can(store_id, kind, case when kind = 'assistant' then 'edit' else 'agenda' end));
