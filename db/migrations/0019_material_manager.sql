-- 材料担当: 管理者が決める「印」。材料費の記録を、全店ぶん見られて、書き込める（統括の画面も見られる）。
alter table public.memberships add column material_manager boolean not null default false;
grant select (material_manager) on public.memberships to app_user;

create function app.is_material_mgr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((app.me()).material_manager, false) and not coalesce((app.me()).display_only, false)
$$;
grant execute on function app.is_material_mgr() to app_user;

drop policy mo_select on public.material_orders;
create policy mo_select on public.material_orders for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only()
         and (app.has_perm('material.view', store_id) or app.is_material_mgr())
         and (deleted_at is null or app.my_level() >= 3 or app.is_material_mgr()));
drop policy mo_insert on public.material_orders;
create policy mo_insert on public.material_orders for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only()
              and (app.has_perm('material.edit', store_id) or app.is_material_mgr()) and created_by = app.uid());
drop policy mo_update on public.material_orders;
create policy mo_update on public.material_orders for update to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.edit', store_id) or app.is_material_mgr()))
  with check (company_id = app.my_company_id() and (app.has_perm('material.edit', store_id) or app.is_material_mgr()));
drop policy mb_select on public.material_budgets;
create policy mb_select on public.material_budgets for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.view', store_id) or app.is_material_mgr()));
drop policy mol_select on public.material_order_log;
create policy mol_select on public.material_order_log for select to app_user
  using (company_id = app.my_company_id() and ((app.my_level() >= 3 and app.has_perm('material.view', store_id)) or app.is_material_mgr()));
drop policy moi_select on public.material_order_images;
create policy moi_select on public.material_order_images for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.view', store_id) or app.is_material_mgr()));
drop policy moi_insert on public.material_order_images;
create policy moi_insert on public.material_order_images for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.edit', store_id) or app.is_material_mgr()) and created_by = app.uid());

create or replace function public.material_cancel(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare o public.material_orders;
begin
  select * into o from public.material_orders where id = p_id and deleted_at is null;
  if not found or o.company_id <> app.my_company_id() or app.me_display_only()
     or not (app.has_perm('material.edit', o.store_id) or app.is_material_mgr()) then return false; end if;
  update public.material_orders set deleted_at = now(), deleted_by = app.uid(), updated_at = now(), updated_by = app.uid() where id = p_id;
  return true;
end $$;
