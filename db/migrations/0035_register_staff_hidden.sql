-- レジ売上は、シフト担当以上（自店）と事務員さんだけが見られる。一般のスタッフ(Lv1)には見せない。
drop policy rss_select on public.register_sales_status;
drop policy rs_select on public.register_sales;
create policy rss_select on public.register_sales_status for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and app.my_level() >= 2 and (app.my_level() = 4 or store_id = (app.me()).store_id));
create policy rs_select on public.register_sales for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and app.my_level() >= 2 and (app.my_level() = 4 or store_id = (app.me()).store_id));
