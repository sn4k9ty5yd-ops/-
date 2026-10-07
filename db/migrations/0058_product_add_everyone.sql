-- 商品の追加は、全員。スタッフ・シフト担当は自分のお店だけ（店長・事務員さんは、従来どおり選んだお店）。お店で使わない・内容の変更・取扱い終了は従来どおり。
create or replace function public.product_create(p_kind text, p_items jsonb, p_stores uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.memberships; it jsonb; pid uuid; created int := 0; skipped int := 0; sid uuid; nm text; cost bigint;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  if p_kind not in ('retail','supply') then raise exception 'bad kind'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 1000 then raise exception 'bad items'; end if;
  if coalesce(array_length(p_stores, 1), 0) = 0 then raise exception 'no stores'; end if;
  if me.level < 3 and exists (select 1 from unnest(p_stores) s where s <> me.store_id) then raise exception 'forbidden'; end if;
  if exists (select 1 from unnest(p_stores) s where not exists (select 1 from public.stores st where st.id = s and st.company_id = me.company_id)) then raise exception 'forbidden'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    nm := btrim(coalesce(it->>'name', ''));
    cost := coalesce((it->>'costPrice')::bigint, 0);
    if nm = '' or length(nm) > 200 or cost < 0 or cost > 100000000 then raise exception 'bad item'; end if;
    insert into public.products (company_id, kind, maker, name, spec, cost_price)
      values (me.company_id, p_kind, left(btrim(coalesce(it->>'maker','')), 100), nm, left(btrim(coalesce(it->>'spec','')), 100), cost)
      on conflict (company_id, kind, maker, name, spec) do nothing returning id into pid;
    if pid is null then skipped := skipped + 1;
    else
      created := created + 1;
      foreach sid in array p_stores loop
        insert into public.product_stores (product_id, store_id, company_id) values (pid, sid, me.company_id) on conflict do nothing;
      end loop;
    end if;
    pid := null;
  end loop;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
  values (me.company_id, me.id, 'product.create', null, jsonb_build_object('kind', p_kind, 'created', created, 'skipped', skipped));
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;
