-- 満点は、項目の数×5（採点の点数の合計）。合格点は、マニュアルどおりの割合（8割）に合わせる。
update check_sheets s set
  max_points = (select count(*) * 5 from check_items i where i.sheet_id = s.id and i.active),
  pass_points = ceil((select count(*) * 5 from check_items i where i.sheet_id = s.id and i.active) * 0.8)
where exists (select 1 from check_items i where i.sheet_id = s.id and i.active);
