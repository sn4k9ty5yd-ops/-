/** 変更の記録（だれが・どこを・いつ）。書き込みの操作がうまくいくたびに、1行残す。パスコードや内容そのものは残さない */

const AREAS: [RegExp, string][] = [
  [/^\/api\/(shifts|day|day-limits|periods|requests)(\/|$)/, "シフト"],
  [/^\/api\/attendance/, "出勤簿"],
  [/^\/api\/stocktakes/, "棚卸し"],
  [/^\/api\/products/, "商品"],
  [/^\/api\/stock(\/|$)/, "在庫"],
  [/^\/api\/material/, "材料費"],
  [/^\/api\/tester/, "業務に回した分"],
  [/^\/api\/staff-buy/, "スタッフ購入"],
  [/^\/api\/sales/, "売上"],
  [/^\/api\/(leave|paid-leave)/, "有給"],
  [/^\/api\/lessons/, "レッスン記録"],
  [/^\/api\/lesson-check/, "レッスンチェック"],
  [/^\/api\/manual/, "マニュアル"],
  [/^\/api\/meetings/, "ミーティング"],
  [/^\/api\/councils/, "AI会議"],
  [/^\/api\/staff/, "スタッフ管理"],
  [/^\/api\/stores/, "店舗"],
  [/^\/api\/(settings|notice-settings)/, "設定"],
  [/^\/api\/records/, "税務署用の書面"],
  [/^\/api\/feedback/, "ご要望"],
];
const ACTIONS: Record<string, string> = {
  save: "保存", "save-own": "自分の分を保存", add: "追加", update: "直した", cancel: "取り消し", delete: "削除", create: "作成", next: "次の期間を作成", status: "状態を変更",
  submit: "提出", review: "確認・確定", clear: "消した", draft: "下書きを反映", fill: "まとめて入力", sync: "商品を反映", budget: "予算を変更", rates: "割合を変更", commission: "歩合を決めた",
  decide: "許可・却下", request: "申請", ai: "AIを使った", ai_paste: "AIの結果を残した", move: "異動", record: "記録", settings: "設定を変更", apply: "反映", limits: "発注点を変更", recount: "数え直し", "window-status": "受付を変更",
};
const STATUS: Record<string, string> = { collecting: "希望休の受付", closed: "締切", drafting: "出勤簿づくり", confirmed: "確定", published: "公開", submitted: "提出", acknowledged: "確認済み", open: "ひとつ戻した", preparing: "準備中" };
const STAFF_SUB: Record<string, string> = { disable: "退職にした", level: "レベルを変えた", passcode: "パスコードを再発行", profile: "名前・番号を変えた", release: "番号を空けた", "retire-on": "退職予定日を決めた", rank: "ランクを変えた", move: "所属店舗を変えた", onshift: "シフトに入る/外す", "edu-lead": "教育担当を変えた", evaluate: "技術評価の担当を変えた", "material-manager": "材料担当を変えた", bulk: "まとめて登録", disabled: "退職にした" };

/** 記録しない操作（自分のパスコード・通知・ログアウトなど） */
export const NOT_LOGGED = /^\/api\/(security|notifications|office-inbox|push\/|logout|me$|mentor|interviews)/;   // メンターと面談は、使ったことも記録しない

export function describeActivity(path: string, body: Record<string, unknown> | null): { area: string; what: string } {
  const area = AREAS.find(([re]) => re.test(path))?.[1] ?? path.replace(/^\/api\//, "");
  if (area === "スタッフ管理") {
    const sub = path.split("/")[4] ?? path.split("/")[3] ?? "";
    return { area, what: STAFF_SUB[sub] ?? (sub ? sub : "登録") };
  }
  const a = typeof body?.action === "string" ? body.action : "";
  let what = ACTIONS[a] ?? (a || "変更");
  const st = typeof body?.status === "string" ? body.status : "";
  if (st && STATUS[st]) what = `${what}（${STATUS[st]}）`;
  return { area, what };
}

/** 「正美さんへの提出・報告」にあたる操作か（アプリ制作者に、そのたびに知らせる） */
export function isOfficeReport(path: string, body: Record<string, unknown> | null): boolean {
  const a = typeof body?.action === "string" ? body.action : "";
  const st = typeof body?.status === "string" ? body.status : "";
  if (/^\/api\/periods/.test(path)) return st === "submitted" || st === "acknowledged";
  if (/^\/api\/attendance/.test(path)) return a === "status" && (st === "submitted" || st === "acknowledged");
  if (/^\/api\/stocktakes\//.test(path)) return a === "status" && (st === "submitted" || st === "acknowledged");
  if (/^\/api\/sales/.test(path)) return a === "submit" || a === "review";
  if (/^\/api\/(paid-leave|leave)/.test(path)) return a === "request" || a === "submit" || a === "decide";
  if (/^\/api\/material/.test(path)) return a === "add";
  return false;
}
