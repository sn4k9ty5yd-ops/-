-- レッスンチェック表（採点）。マニュアルの「レッスンチェック表」を、アプリの中で採点できるようにする。
-- 1年目・2年目の表（項目・満点・合格点・回数）は、最初に入れておく。あとから、画面で直せる。
create table public.check_sheets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  grade       text not null default '1年目',
  name        text not null check (length(btrim(name)) > 0),
  memo        text not null default '',
  max_points  int  not null default 0 check (max_points between 0 and 1000),
  pass_points int  not null default 0 check (pass_points between 0 and 1000),
  max_attempts int not null default 10 check (max_attempts between 1 and 30),
  sort_order  int  not null default 0,
  active      boolean not null default true,
  unique (id, company_id)
);
create table public.check_items (
  id         uuid primary key default gen_random_uuid(),
  sheet_id   uuid not null,
  company_id uuid not null,
  name       text not null check (length(btrim(name)) > 0),
  sort_order int  not null default 0,
  active     boolean not null default true,
  foreign key (sheet_id, company_id) references public.check_sheets (id, company_id) on delete cascade
);
create index on public.check_items (sheet_id, sort_order);
create table public.check_attempts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  store_id    uuid not null,                    -- 受ける人のお店
  sheet_id    uuid not null,
  trainee_id  uuid not null references public.memberships(id),
  attempt_no  int  not null check (attempt_no between 1 and 30),
  assessor_id uuid references public.memberships(id),   -- 査定者
  time_text   text not null default '' check (length(time_text) <= 20),   -- タイム
  comment     text not null default '' check (length(comment) <= 1000),
  total       int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (sheet_id, company_id) references public.check_sheets (id, company_id),
  unique (sheet_id, trainee_id, attempt_no)
);
create index on public.check_attempts (trainee_id, sheet_id);
create table public.check_scores (
  attempt_id uuid not null references public.check_attempts(id) on delete cascade,
  item_id    uuid not null references public.check_items(id),
  score      int  not null check (score between 0 and 5),
  primary key (attempt_id, item_id)
);

alter table public.check_sheets  enable row level security;
alter table public.check_items   enable row level security;
alter table public.check_attempts enable row level security;
alter table public.check_scores  enable row level security;

-- 採点できる人: 事務員さん(全店)、自店の店長・教育担当・技術評価をつけられる人
create function app.can_assess(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and (m.level = 4 or (m.store_id = p_store and (m.level >= 3 or m.can_evaluate or m.edu_lead))) from app.me() m), false)
$$;
-- 表（項目）を直せる人: 事務員さん・教育担当
create function app.can_edit_checks() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not m.display_only and (m.level = 4 or m.edu_lead) from app.me() m), false)
$$;
grant execute on function app.can_assess(uuid), app.can_edit_checks() to app_user;

create policy cks_select on public.check_sheets for select to app_user using (company_id = app.my_company_id() and not app.me_display_only());
create policy cki_select on public.check_items  for select to app_user using (company_id = app.my_company_id() and not app.me_display_only());
create policy cka_select on public.check_attempts for select to app_user
  using (company_id = app.my_company_id() and not app.me_display_only() and (trainee_id = app.uid() or app.can_assess(store_id)));
create policy ckc_select on public.check_scores for select to app_user
  using (exists (select 1 from public.check_attempts a where a.id = attempt_id));
grant select on public.check_sheets, public.check_items, public.check_attempts, public.check_scores to app_user;

-- 表の項目を直す（追加・名前・満点・合格点・回数・並び・しまう）。items=[{id?, name}] の並びが、そのまま順番
create function public.check_sheet_save(p_id uuid, p_grade text, p_name text, p_memo text, p_max int, p_pass int, p_attempts int, p_active boolean, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.memberships; sid uuid := p_id; it jsonb; i int := 0; iid uuid; keep uuid[] := '{}';
begin
  select * into me from app.me();
  if me.id is null or not app.can_edit_checks() then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_name,'')) = '' or p_max < 0 or p_pass < 0 or p_pass > p_max or p_attempts < 1 or p_attempts > 30 then raise exception 'bad sheet'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 40 then raise exception 'bad items'; end if;
  if sid is null then
    insert into public.check_sheets (company_id, grade, name, memo, max_points, pass_points, max_attempts, sort_order, active)
      values (me.company_id, left(btrim(p_grade),20), left(btrim(p_name),60), left(coalesce(p_memo,''),300), p_max, p_pass, p_attempts,
              coalesce((select max(sort_order) + 1 from public.check_sheets where company_id = me.company_id), 0), coalesce(p_active, true)) returning id into sid;
  else
    update public.check_sheets set grade = left(btrim(p_grade),20), name = left(btrim(p_name),60), memo = left(coalesce(p_memo,''),300), max_points = p_max, pass_points = p_pass,
           max_attempts = p_attempts, active = coalesce(p_active, true) where id = sid and company_id = me.company_id;
    if not found then raise exception 'forbidden'; end if;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if btrim(coalesce(it->>'name','')) = '' then continue; end if;
    iid := nullif(it->>'id','')::uuid;
    if iid is not null and exists (select 1 from public.check_items where id = iid and sheet_id = sid) then
      update public.check_items set name = left(btrim(it->>'name'),200), sort_order = i, active = true where id = iid;
    else
      insert into public.check_items (sheet_id, company_id, name, sort_order) values (sid, me.company_id, left(btrim(it->>'name'),200), i) returning id into iid;
    end if;
    keep := keep || iid;
  end loop;
  -- 一覧から外した項目は、しまう（過去の点数は残す）
  update public.check_items set active = false where sheet_id = sid and not (id = any(keep));
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'check.sheet_save', sid, jsonb_build_object('name', p_name));
  return sid;
end $$;

-- 1回分の採点を保存（その回の点数・タイム・コメント）。査定者は、押した本人
create function public.check_attempt_save(p_sheet uuid, p_trainee uuid, p_no int, p_time text, p_comment text, p_scores jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.memberships; tr public.memberships; sh public.check_sheets; aid uuid; tot int := 0; s jsonb; sc int;
begin
  select * into me from app.me();
  if me.id is null or me.display_only then raise exception 'forbidden'; end if;
  select * into tr from public.memberships where id = p_trainee and company_id = me.company_id and status = 'active';
  select * into sh from public.check_sheets where id = p_sheet and company_id = me.company_id and active;
  if tr.id is null or sh.id is null then raise exception 'forbidden'; end if;
  if not app.can_assess(tr.store_id) then raise exception 'forbidden'; end if;
  if tr.id = me.id then raise exception 'self'; end if;
  if p_no < 1 or p_no > sh.max_attempts then raise exception 'bad no'; end if;
  if jsonb_typeof(p_scores) <> 'array' then raise exception 'bad scores'; end if;
  insert into public.check_attempts (company_id, store_id, sheet_id, trainee_id, attempt_no, assessor_id, time_text, comment)
    values (me.company_id, tr.store_id, sh.id, tr.id, p_no, me.id, left(btrim(coalesce(p_time,'')),20), left(coalesce(p_comment,''),1000))
    on conflict (sheet_id, trainee_id, attempt_no) do update set assessor_id = me.id, time_text = excluded.time_text, comment = excluded.comment, updated_at = now()
    returning id into aid;
  delete from public.check_scores where attempt_id = aid;
  for s in select * from jsonb_array_elements(p_scores) loop
    sc := (s->>'score')::int;
    if sc is null or sc < 0 or sc > 5 then raise exception 'bad score'; end if;
    if not exists (select 1 from public.check_items where id = (s->>'itemId')::uuid and sheet_id = sh.id) then raise exception 'bad item'; end if;
    insert into public.check_scores (attempt_id, item_id, score) values (aid, (s->>'itemId')::uuid, sc);
    tot := tot + sc;
  end loop;
  update public.check_attempts set total = tot where id = aid;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail)
    values (me.company_id, me.id, 'check.attempt_save', aid, jsonb_build_object('trainee', tr.id, 'sheet', sh.id, 'no', p_no, 'total', tot));
  return jsonb_build_object('id', aid, 'total', tot, 'passed', tot >= sh.pass_points, 'store', tr.store_id);
end $$;

-- 1回分の採点を消す（まちがいの取り消し）。消すのは、採点できる人
create function public.check_attempt_delete(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me public.memberships; a public.check_attempts;
begin
  select * into me from app.me();
  select * into a from public.check_attempts where id = p_attempt and company_id = me.company_id;
  if me.id is null or a.id is null or not app.can_assess(a.store_id) then raise exception 'forbidden'; end if;
  delete from public.check_attempts where id = p_attempt;
  insert into public.audit_logs (company_id, actor_id, action, target_id, detail) values (me.company_id, me.id, 'check.attempt_delete', a.trainee_id, jsonb_build_object('sheet', a.sheet_id, 'no', a.attempt_no));
end $$;
grant execute on function public.check_sheet_save(uuid, text, text, text, int, int, int, boolean, jsonb),
  public.check_attempt_save(uuid, uuid, int, text, text, jsonb), public.check_attempt_delete(uuid) to app_user;

-- 最初の表（いま登録されている会社に入れる）
do $seed$
declare c record; sh jsonb; sid uuid; n int := 0; it text; i int;
  seed jsonb := $json$[{"grade": "1年目", "name": "シャンプー", "memo": "", "max": 50, "pass": 40, "attempts": 10, "items": ["タオル・クロスの掛け方が正しくできているか", "シャンプー時の必要な声掛け", "手捌き、繋ぎがしっかりできているか（リズム）", "指抜き、あたりはいいか", "力加減はいいか", "すすぎは十分に出来ているか（ネープはつってないか）", "耳、額に泡やお湯が跳ねていないか", "タオルドライ、コーミングは出来ているか", "マッサージの当て方が正しく出来ているか"]}, {"grade": "1年目", "name": "ヘッドスパ", "memo": "リフトアップスパ30分でシャンプー込みでチェック", "max": 40, "pass": 32, "attempts": 10, "items": ["力加減はいいか（メリハリ）", "大きく回せているか", "手捌き、繋ぎがしっかりできているか（リズム）", "時間通りできているか", "すすぎは十分に出来ているか（ネープはつってないか）", "耳、額に泡やお湯が跳ねていないか", "マッサージのツボがしっかり入っているか", "手順通りに出来ているか"]}, {"grade": "1年目", "name": "ウィッグカラー", "memo": "目安：1週間・タイム20分", "max": 25, "pass": 20, "attempts": 10, "items": ["時間内に塗布できているか", "塗布がきれいにできているか", "お客様目線の仕事ができているか", "はけの正しい使い方ができているか", "スライスがきれいに取れているか"]}, {"grade": "1年目", "name": "カラーモデル", "memo": "鎖骨より下の長さ・制限時間90分・ロング5人〜10人", "max": 35, "pass": 28, "attempts": 10, "items": ["カウンセリングが出来ているか（要望）", "時間内か（90分）", "髪質に合わせた塗り分けが出来ているか（薬剤の塗布量）", "鏡を見て施術をしているか（お客様の表情の確認）", "声掛けができているか（染みやすい下の事前確認も）", "仕上がりがイメージ通りか（2レベル以上の差にする、トーンアップダウンどちらでもOK）", "綺麗な仕事が出来ているか（クロスや床、ワゴンを綺麗に）"]}, {"grade": "1年目", "name": "マニキュア", "memo": "目安：1週間・タイム20分（加温10分・自然5分）", "max": 25, "pass": 20, "attempts": 10, "items": ["地肌についていないか", "コームを正しく使い塗布出来ているか", "マニキュアとカラー剤の違いを説明できるか", "時間内に出来ているか", "正しいラップの仕方が出来ているか"]}, {"grade": "1年目", "name": "ホイルワーク", "memo": "29分・25枚（ブロッキング込み）", "max": 30, "pass": 24, "attempts": 10, "items": ["ブロッキングが正しく取れているか", "コームを正しく使い塗布出来ているか", "マニキュアとカラー剤の違いを説明できるか", "時間内に出来ているか", "正しいラップの仕方が出来ているか"]}, {"grade": "1年目", "name": "パーマ・髪質改善", "memo": "", "max": 35, "pass": 28, "attempts": 10, "items": ["カウンセリング　イメージの共有ができているか", "毛髪診断　毛髪に合った薬剤選定、前処理", "声かけ、気遣い　初施術だと仮定し、工程の説明をできるか", "スピード　きれいにスピーディーに作業ができるか", "鏡を見て施術しているか", "仕上げ方の説明　モデルが理解できているか", "仕上がりはイメージ通りか"]}, {"grade": "2年目", "name": "ウィッグカット（ワンレングス）", "memo": "20分（ブロー込み）。ウィッグ1頭で3回カットし、4頭目で合格を目指す", "max": 40, "pass": 32, "attempts": 12, "items": ["ノンテンションでコーミングが出来ているか", "左右対称になっているか", "まっすぐ板状に切れているか", "時間内に出来ているか", "シザーの使い方は適切に出来ているか", "ボディーポジションは適切か", "施術は綺麗か"]}, {"grade": "2年目", "name": "ウィッグカット（セイムレイヤー・グラボブ）", "memo": "20分（ブロー込み）。ウィッグ1頭で3回カットし、4頭目で合格を目指す", "max": 40, "pass": 32, "attempts": 12, "items": ["カットラインを意識し、ブローでシルエットを作れているか", "ウェット具合は適切か", "カットラインが綺麗で、丸さを意識し同じ長さできれているか", "時間内に出来ているか", "鏡を見ているか", "ボディーポジションは適切か", "施術は綺麗か", "パネルの引き出し方は綺麗か　テンションは適切か"]}, {"grade": "2年目", "name": "スタイリストチェック", "memo": "45分（最終試験）", "max": 25, "pass": 20, "attempts": 1, "items": ["モデルに似合ったライン設定、ウェットバランスが取れているか", "狙い通りの毛量、質感調整が出来ているか", "顔周り、毛先のディテールにこだわりを感じているか", "フィニッシングにトレンド感を入れ、似合わせが出来ているか", "カット中の身のこなし、姿勢、リズム、時間配分は適切か"]}]$json$::jsonb;
begin
  for c in select id from public.companies loop
    n := 0;
    for sh in select * from jsonb_array_elements(seed) loop
      n := n + 1;
      insert into public.check_sheets (company_id, grade, name, memo, max_points, pass_points, max_attempts, sort_order)
        values (c.id, sh->>'grade', sh->>'name', sh->>'memo', (sh->>'max')::int, (sh->>'pass')::int, (sh->>'attempts')::int, n) returning id into sid;
      i := 0;
      for it in select jsonb_array_elements_text(sh->'items') loop
        i := i + 1;
        insert into public.check_items (sheet_id, company_id, name, sort_order) values (sid, c.id, it, i);
      end loop;
    end loop;
  end loop;
end $seed$;
