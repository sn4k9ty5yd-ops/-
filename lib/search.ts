import { HELP } from "./help";
import { isOfficeOnly } from "./permissions";
import type { Me } from "./service";

/** ホームの検索。「どこに何があるか」を、キーワードで探す。画面（機能）と、ヘルプの「やり方」の両方から探す。 */
export interface SearchItem { title: string; sub: string; href: string; icon: string; keys: string; show?: (me: Me) => boolean }


export const SEARCH_ITEMS: SearchItem[] = [
  { icon: "📨", title: "スタッフからの通知", sub: "スタッフからの提出・報告が集まる画面（押すとその画面へ）", href: "/staff-notices", keys: "スタッフからの通知 通知 提出 報告 申請 有給 事務員 まとめ", show: (me) => me.level >= 4 },
  { icon: "📅", title: "シフトを見る", sub: "今日だれが出勤か・月のシフト・みんなの休み", href: "/shifts", keys: "上限 何人まで休める 休める人数 シフト 出勤 今日 カレンダー 誰 だれ 休み みんなの休み 見る" },
  { icon: "🌴", title: "希望休を出す", sub: "休みたい日を出す（公休・有給）", href: "/requests", keys: "希望休 休みたい 休み 公休 有給 申請 出す", show: (me) => !me.displayOnly },
  { icon: "🏝️", title: "有給申請", sub: "有給を取りたい日を、いつでも申請（店長が確認 → 正美さんが許可）", href: "/leave", keys: "有給 ゆうきゅう 提出 変更 申請 休暇", show: (me) => !me.displayOnly },
  { icon: "📅", title: "社長・役員の出勤と休み（カレンダーだけの人）", sub: "出勤簿には入れず、シフトのカレンダーにだけ出す。休みだけを入れる", href: "/admin/staff", keys: "社長 役員 鬼塚 大庭 カレンダーだけ 出勤簿に入れない 休み 固定休 オルガン 天神", show: (me) => me.level >= 2 && !me.displayOnly },
  { icon: "📅", title: "希望休の進み具合のカレンダー", sub: "つくる：日ごとに、スタイリスト・アシスタントが何人休むか／上限を見て、その場で変える", href: "/admin/periods", keys: "希望休 進み具合 進捗 カレンダー 上限 休める人数 スタイリスト アシスタント 予約 つくる", show: (me) => me.level >= 2 && !me.displayOnly },
  { icon: "🗂️", title: "シフトを作る（進み具合・締切）", sub: "次のシフトを作る・締切・確定・公開・オフィスに提出", href: "/admin/periods", keys: "上限 何人まで休める 休める人数 シフト 作る 次のシフト 期間 締切 確定 公開 提出 進み具合 やること 確認済み", show: (me) => me.level >= 2 },
  { icon: "✏️", title: "出勤簿予定", sub: "入店・退店・休憩を入れる表（シフトの予定）", href: "/admin/shifts", keys: "出勤簿 予定 a4 一枚 入店 退店 休憩 実働 時間 プリント 印刷 並び", show: (me) => me.level >= 2 },
  { icon: "🧾", title: "出勤簿確定", sub: "実際の勤務の表（同期・税務署に出す用）", href: "/admin/attendance", keys: "出勤簿 確定 実際 勤務 税務署 同期 入店 退店 休憩 実働 プリント 印刷", show: (me) => me.level >= 2 },
  { icon: "📖", title: "マニュアル", sub: "教育・営業マニュアル・技術動画・技術評価", href: "/manual", keys: "マニュアル 教育 営業 技術 動画 カット カラー ルール 評価 手順" },
  { icon: "🚃", title: "定期券の提出", sub: "毎月1回、定期券の写真を出す・名簿・確認", href: "/commute", keys: "定期券 定期 何日分 もらっている 受け取り 通勤 写真 提出 名簿 交通費 期限", show: (me) => !me.displayOnly },
  { icon: "🔗", title: "マニュアルの外部リンク", sub: "マニュアルの中にあった、外のサイトへのリンク（YouTube以外）のまとめ", href: "/manual/external", keys: "外部 リンク 資料 サイト url マニュアル", show: (me) => !me.displayOnly },
  { icon: "📝", title: "レッスンチェック表", sub: "アシスタントの採点（1〜5点）", href: "/lesson-check", keys: "レッスン チェック 採点 点数 合格 アシスタント 技術評価", show: (me) => !me.displayOnly },
  { icon: "🎓", title: "レッスン記録", sub: "アシスタントが今日何をしたかを記録・報告", href: "/lessons", keys: "レッスン 記録 報告 何人目 カット モデル ウィッグ", show: (me) => (me.level >= 3 || !!me.eduLead) && !isOfficeOnly(me) },
  { icon: "🎓", title: "自分のレッスン", sub: "自分がしたレッスンをカレンダーで見る", href: "/my-lessons", keys: "自分 レッスン 練習 何人目 時間", show: (me) => me.rank === "assistant" },
  { icon: "🧴", title: "材料費（発注額）", sub: "発注した金額・業者・スクリーンショット・予算", href: "/material", keys: "材料費 発注 発注額 金額 業者 ディーラー カテゴリー 髪ドラ ダリア カラー ストレート 予算 スクリーンショット 税込 税抜 何個 商品", show: (me) => !me.displayOnly },
  { icon: "📦", title: "在庫", sub: "在庫の数・入庫・出庫・数え直し・発注の目安", href: "/material/stock", keys: "在庫 入庫 出庫 数え直し 発注点 足りない 少ない", show: (me) => !me.displayOnly },
  { icon: "🧪", title: "業務に回した分", sub: "店販を業務に使った分（テスター）を記録", href: "/material/tester", keys: "業務に回した分 テスター 店販 使った 写真 読み込み", show: (me) => !me.displayOnly },
  { icon: "🛍️", title: "スタッフ購入", sub: "スタッフ価格の購入・給料から引く額", href: "/material/staff-buy", keys: "スタッフ購入 個人購入 給料 天引き 引く 半値 仕入値", show: (me) => !me.displayOnly },
  { icon: "📊", title: "材料費統括", sub: "月ごと・お店ごと・商品ごとの割合", href: "/material/summary", keys: "材料費 統括 割合 グラフ 年 月 お店別 商品別", show: (me) => me.level === 4 || !!me.materialManager },
  { icon: "📋", title: "棚卸し", sub: "店販・業務の棚卸し（数量を入れる・提出）", href: "/admin/stocktake", keys: "棚卸し 棚卸 数量 提出 金額 店販 業務", show: (me) => !me.displayOnly },
  { icon: "🏷️", title: "商品一覧", sub: "店販・業務の商品と仕入値・追加・写真から読み込み", href: "/admin/products", keys: "商品 一覧 追加 登録 仕入値 店販 業務 取扱い終了 髪にドラマ", show: (me) => me.level >= 3 },
  { icon: "📈", title: "自分の売上", sub: "自分の売上を入れて店長に提出", href: "/my-sales", keys: "売上 自分 提出 歩合 着付け メイク ヘッドスパ ヘッドスパ申請 スパ申請 客数 客単価 目標", show: (me) => !me.displayOnly },
  { icon: "💴", title: "お店の売上", sub: "自店・全店の売上の確認・確定", href: "/sales", keys: "売上 確認 確定 差し戻し ランキング 歩合 お店 全店 目標", show: (me) => me.level >= 3 },
  { icon: "💬", title: "メンター（チャット）", sub: "悩みを相談できるチャット", href: "/mentor", keys: "メンター 相談 チャット 悩み mbti monday", show: (me) => !me.displayOnly },
  { icon: "📄", title: "面談シート", sub: "面談の記録を書いて店長に提出", href: "/interviews", keys: "面談 シート 4月 6月 10月 2月 提出 メンター 振り返り", show: (me) => !me.displayOnly },
  { icon: "🔮", title: "占い", sub: "星座とMBTIの今日の運勢・四柱推命・六星占術・動物占い（AI）", href: "/mentor/fortune", keys: "占い 運勢 毎朝 通知 ラッキーカラー ラッキーアイテム おしゃれ 美容師 星座 相性 誕生日 mbti 四柱推命 六星占術 動物占い 個性心理學 命式 星人 キャラクター ししちゅうすいめい ろくせいせんじゅつ どうぶつうらない", show: (me) => !me.displayOnly },
  { icon: "🧠", title: "みんなのMBTI", sub: "自分のお店のみんなのMBTIの一覧（全店は鬼塚さん以上）", href: "/mentor/mbti", keys: "mbti みんな 一覧 性格 タイプ" },
  { icon: "🎙️", title: "ミーティング", sub: "ボイスメモ・文字起こし・議事録・要約・マインドマップ", href: "/meetings", keys: "ミーティング 会議 議事録 ボイスメモ 文字起こし 要約 マインドマップ 録音", show: (me) => !me.displayOnly },
  { icon: "👔", title: "スタイリストミーティング・アシスタントミーティング", sub: "スタイリスト用・アシスタント用の会議（アシスタントは、スタイリストが決めた話し合うことを見ながら話す）", href: "/meetings", keys: "スタイリストミーティング アシスタントミーティング スタイリスト アシスタント 会議 話し合うこと 議題 ミーティング", show: (me) => !me.displayOnly },
  { icon: "🤖", title: "AI会議（ミーティング）", sub: "課題（テーマ）を入れると、AIが会議して結論と行動計画を出す（だれでも・いつでも）", href: "/councils", keys: "ミーティング ai 会議 課題 テーマ 人格 議論 行動計画 エーアイ", show: (me) => !me.displayOnly },
  { icon: "🔒", title: "AI会議（僕専用）", sub: "アプリ制作者だけが読める、AI会議", href: "/councils/private", keys: "ai 会議 僕専用 専用 課題 テーマ", show: (me) => !!me.appOwner },
  { icon: "🔔", title: "お知らせ", sub: "休みのかぶり・話し合い・有給などのお知らせ", href: "/inbox", keys: "お知らせ 通知 かぶり 話し合い 受信箱", show: (me) => !me.displayOnly },
  { icon: "📣", title: "スマホの通知を設定する", sub: "通知をオン・毎朝の通知の時刻", href: "/notify", keys: "通知 プッシュ スマホ オン 朝 毎朝 ホーム画面 iphone android", show: (me) => !me.displayOnly },
  { icon: "🔐", title: "パスコードを変える・ログインの記録", sub: "自分のパスコード・ログインの履歴", href: "/security", keys: "パスコード 変える 変更 パスワード セキュリティ ログイン 記録 忘れた" },
  { icon: "❓", title: "ヘルプ・ご要望", sub: "やり方の説明・「こうしてほしい」を送る（右下の「？」でも聞けます）", href: "/help", keys: "ヘルプ 使い方 やり方 ご要望 要望 困った 質問 問い合わせ" },
  { icon: "🧑‍🤝‍🧑", title: "スタッフ", sub: "登録・退職・パスコード再発行・異動・シフトから外す", href: "/admin/staff", keys: "スタッフ 登録 退職 退職予定日 パスコード 再発行 異動 所属 店舗 シフトから外す 社員番号 名前 ランク 教育担当 材料担当", show: (me) => me.level >= 3 },
  { icon: "🏬", title: "店舗の編集", sub: "お店の追加・名前・営業時間・閉店", href: "/admin/stores", keys: "店舗 お店 追加 名前 営業時間 土曜 閉店 オープン クローズ", show: (me) => me.level >= 4 },
  { icon: "⚙️", title: "設定（休憩のルール）", sub: "休憩・実働のルール・バックアップ", href: "/admin/settings", keys: "設定 休憩 実働 ルール 8時間 バックアップ ダウンロード", show: (me) => me.level >= 3 },
  { icon: "🧾", title: "税務署用の書面", sub: "期間をえらんで書面（印刷・PDF）にする", href: "/admin/records", keys: "税務署 調査 社員 えらぶ 期間 書面 印刷 pdf 名簿 出勤簿 材料費 記録 提出", show: (me) => me.level >= 4 },
  { icon: "🔑", title: "AIのカギ", sub: "AI（Gemini）のカギを入れる", href: "/admin/ai", keys: "ai カギ キー gemini ジェミニ api", show: (me) => !!me.appOwner },
  { icon: "🕵️", title: "変更の記録", sub: "だれが・どこを・いつ変更したか", href: "/admin/activity", keys: "変更 記録 ログ だれが いつ", show: (me) => !!me.appOwner },
  { icon: "💌", title: "届いたご要望", sub: "みんなからの「こうしてほしい」", href: "/admin/feedback", keys: "ご要望 要望 届いた 返事", show: (me) => !!me.appOwner },
  { icon: "📘", title: "アプリの説明書", sub: "鬼塚さん用・正美さん用・Zoom台本", href: "/admin/guide", keys: "説明書 鬼塚さん 事務員 zoom 台本 お知らせ文", show: (me) => !!me.appOwner },
];

/** ひらがな→カタカナ・全角→半角・大文字→小文字をそろえる（「ゆうきゅう」でも「有給」でも見つかるように、読みは keys に入れてある） */
export function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/[\s　]+/g, " ").trim();
}

/** 漢字の読み（ひらがなで入れても見つかるように） */
const READINGS: Record<string, string> = { 有給: "ゆうきゅう", 希望休: "きぼうきゅう", 出勤簿: "しゅっきんぼ", 出勤: "しゅっきん", 棚卸: "たなおろし", 在庫: "ざいこ", 売上: "うりあげ", 材料費: "ざいりょうひ", 退職: "たいしょく", 休憩: "きゅうけい", 通知: "つうち", 面談: "めんだん", 議事録: "ぎじろく", 会議: "かいぎ", 税務署: "ぜいむしょ", 店舗: "てんぽ", 発注: "はっちゅう", 商品: "しょうひん", 歩合: "ぶあい", 採点: "さいてん", 異動: "いどう", 要望: "ようぼう", 印刷: "いんさつ", 実働: "じつどう", 入店: "にゅうてん", 退店: "たいてん", 締切: "しめきり", 公開: "こうかい", 確定: "かくてい", 提出: "ていしゅつ", 設定: "せってい", 占い: "うらない", 動画: "どうが", 教育: "きょういく", 営業: "えいぎょう", 休み: "やすみ", 今日: "きょう", 数え直し: "かぞえなおし" };
const withReadings = (text: string) => text + " " + Object.entries(READINGS).filter(([k]) => text.includes(k)).map(([, v]) => v).join(" ");

export interface SearchHit { kind: "page" | "help"; title: string; sub: string; href: string; icon: string }

export function searchAll(query: string, me: Me, limit = 10): SearchHit[] {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const it of SEARCH_ITEMS) {
    if (it.show && !it.show(me)) continue;
    const title = norm(withReadings(it.title)), all = norm(withReadings(`${it.title} ${it.sub} ${it.keys}`));
    if (!tokens.every((t) => all.includes(t))) continue;
    scored.push({ hit: { kind: "page", title: it.title, sub: it.sub, href: it.href, icon: it.icon }, score: tokens.reduce((s, t) => s + (title.includes(t) ? 10 : 3), 0) });
  }
  for (const t of HELP) {
    if (me.level < (t.min ?? 1) || (t.flag === "material" && !(me.level === 4 || me.materialManager)) || (t.flag === "edu" && !(me.level >= 3 || me.eduLead))) continue;
    const title = norm(withReadings(t.title)), all = norm(withReadings(`${t.title} ${t.what} ${t.steps.join(" ")} ${(t.tips ?? []).join(" ")}`));
    if (!tokens.every((k) => all.includes(k))) continue;
    scored.push({ hit: { kind: "help", title: t.title, sub: t.what, href: `/help#h-${t.id}`, icon: t.icon }, score: tokens.reduce((s, k) => s + (title.includes(k) ? 6 : 1), 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.hit);
}
