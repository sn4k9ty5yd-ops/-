-- 材料担当は、全店ではなく「自分の登録店舗」の材料費だけ見られる・書ける。全店を見られるのは、鬼塚さん・正美さん・アプリ制作者（レベル4）だけ。
create function app.is_material_mgr_in(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.material_manager and not m.display_only and m.store_id = p_store from app.me() m), false)
$$;
grant execute on function app.is_material_mgr_in(uuid) to app_user;

drop policy mo_select on public.material_orders;
create policy mo_select on public.material_orders for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only()
         and (app.has_perm('material.view', store_id) or app.is_material_mgr_in(store_id))
         and (deleted_at is null or app.my_level() >= 3 or app.is_material_mgr_in(store_id)));
drop policy mo_insert on public.material_orders;
create policy mo_insert on public.material_orders for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only()
              and (app.has_perm('material.edit', store_id) or app.is_material_mgr_in(store_id)) and created_by = app.uid());
drop policy mo_update on public.material_orders;
create policy mo_update on public.material_orders for update to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.edit', store_id) or app.is_material_mgr_in(store_id)))
  with check (company_id = app.my_company_id() and (app.has_perm('material.edit', store_id) or app.is_material_mgr_in(store_id)));
drop policy mb_select on public.material_budgets;
create policy mb_select on public.material_budgets for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.view', store_id) or app.is_material_mgr_in(store_id)));
drop policy mol_select on public.material_order_log;
create policy mol_select on public.material_order_log for select to app_user
  using (company_id = app.my_company_id() and ((app.my_level() >= 3 and app.has_perm('material.view', store_id)) or app.is_material_mgr_in(store_id)));
drop policy moi_select on public.material_order_images;
create policy moi_select on public.material_order_images for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.view', store_id) or app.is_material_mgr_in(store_id)));
drop policy moi_insert on public.material_order_images;
create policy moi_insert on public.material_order_images for insert to app_user
  with check (company_id = app.my_company_id() and not app.me_display_only() and (app.has_perm('material.edit', store_id) or app.is_material_mgr_in(store_id)) and created_by = app.uid());

create or replace function public.material_cancel(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare o public.material_orders;
begin
  select * into o from public.material_orders where id = p_id and deleted_at is null;
  if not found or o.company_id <> app.my_company_id() or app.me_display_only()
     or not (app.has_perm('material.edit', o.store_id) or app.is_material_mgr_in(o.store_id)) then return false; end if;
  update public.material_orders set deleted_at = now(), deleted_by = app.uid(), updated_at = now(), updated_by = app.uid() where id = p_id;
  return true;
end $$;

-- 店長（レベル3）も、見られるのは自分の登録店舗だけ（全店を見られるのは、鬼塚さん・正美さん・アプリ制作者のレベル4）
insert into public.level_permissions (level, permission, scope) values
  (3, 'staff.view', 'own'), (3, 'product.view', 'own'), (3, 'stocktake.view', 'own'), (3, 'material.view', 'own')
on conflict (level, permission) do update set scope = excluded.scope;
