-- 出勤簿: 休憩時間を、1日ごとに手で決められる（空=会社の休憩ルールで自動計算）
alter table public.shifts add column break_min integer check (break_min is null or (break_min >= 0 and break_min <= 600));
