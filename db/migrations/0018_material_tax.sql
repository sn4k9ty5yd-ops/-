-- 材料費: 入力した金額が「税抜」か「税込」かを残す（保存する金額は、いつも税抜）。
alter table public.material_orders add column tax_mode text not null default 'ex' check (tax_mode in ('ex','in'));
alter table public.material_orders add column entered_amount int;     -- 入力した金額（税込で入れたときの元の金額）
grant update (tax_mode, entered_amount) on public.material_orders to app_user;
