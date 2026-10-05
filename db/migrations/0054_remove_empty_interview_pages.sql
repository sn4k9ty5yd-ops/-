-- マニュアルにあった「4月面談・6月面談・10月面談・2月面談」のページ（レベル4以上だけ・中は空の質問だけ）を消す。
-- 面談は、アプリの「メンター」→「面談シート」で書けるようになったため。子ページがあるものは、消さない。
delete from public.manual_pages p
 where p.title ~ '^[0-9０-９]+月面談$' and p.min_level = 4
   and not exists (select 1 from public.manual_pages c where c.parent_id = p.id);
