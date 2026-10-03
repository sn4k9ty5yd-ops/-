import type { PeriodStatus } from "./service";

/** 次に進めるときのボタンの文言（やさしい言葉） */
export const NEXT_ACTION: Partial<Record<PeriodStatus, { to: PeriodStatus; label: string }>> = {
  preparing: { to: "collecting", label: "希望休の受付を始める" },
  collecting: { to: "closed", label: "受付を締め切る" },
  closed: { to: "drafting", label: "シフト作成を始める" },
  drafting: { to: "confirmed", label: "シフトを確定する" },
  confirmed: { to: "published", label: "スタッフに公開する" },
  published: { to: "submitted", label: "オフィスに提出する" },
  submitted: { to: "acknowledged", label: "確認済みにする" },
};
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const KIND_LABEL: Record<string, string> = { hope: "希望休", paid: "有給", holiday: "公休", other: "その他" };

/** 期間の全日付（YYYY-MM-DD）を返す */
export function daysOf(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(start + "T00:00:00Z"); d <= new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
export const dow = (day: string) => new Date(day + "T00:00:00Z").getUTCDay();
export const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
