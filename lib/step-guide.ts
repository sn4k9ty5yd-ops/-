import type { PeriodStatus } from "./service";

/** 「つくる」の画面で、いまの段階で何をするかを、やさしい言葉で伝える。段階の順番は STATUS_ORDER と同じ */
export interface StepInfo { key: PeriodStatus; short: string; now: string; who: string; open?: "attendance" }
export const STEP_GUIDE: StepInfo[] = [
  { key: "preparing", short: "まだ始めていない", now: "まだ始めていません。始めると、スタッフが休みたい日を出せるようになります。", who: "シフト担当・店長" },
  { key: "collecting", short: "希望休を集める", now: "スタッフが、休みたい日を出しています。締切を決めておくと安心です。出そろったら「受付を締め切って、シフトづくりへ」を押します。", who: "シフト担当・店長" },
  { key: "closed", short: "受付おわり", now: "希望休は、これ以上出せません。次は、出勤簿づくりを始めます。休みの人は自動で入ります。", who: "シフト担当・店長" },
  { key: "drafting", short: "シフトをつくる", now: "休みは自動で入っています。「出勤簿予定」で、入店・退店の時間などを直し、休みがかぶっている日がないか見直してください。できたら「シフトを確定する」を押します。確定すると、月末に出す「出勤簿確定」が自動で作られます。", who: "シフト担当・店長", open: "attendance" },
  { key: "confirmed", short: "確定", now: "シフトが決まりました（出勤簿確定も自動で作られています）。まちがいがなければ、スタッフに公開します。", who: "シフト担当・店長", open: "attendance" },
  { key: "published", short: "公開中", now: "スタッフが、シフトを見られます。直したい所があれば、「出勤簿予定」で直せます。問題がなければ、オフィスに提出します。", who: "シフト担当・店長", open: "attendance" },
  { key: "submitted", short: "提出ずみ", now: "オフィス（事務員さん）が、確認するのを待っています。", who: "事務員さん" },
  { key: "acknowledged", short: "確認ずみ", now: "このシフトは、完了です。おつかれさまでした。", who: "" },
];
