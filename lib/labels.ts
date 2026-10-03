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
export const KIND_LABEL: Record<string, string> = { hope: "公休", paid: "有給", holiday: "公休", other: "その他" };

/** 期間の全日付（YYYY-MM-DD）を返す */
export function daysOf(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(start + "T00:00:00Z"); d <= new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
export const dow = (day: string) => new Date(day + "T00:00:00Z").getUTCDay();
export const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** お店のその日の営業時間（土曜だけ違うお店は、土曜日に自動で切りかわる） */
export function hoursOn(store: { defaultOpen: string; defaultClose: string; satOpen?: string | null; satClose?: string | null } | undefined, day: string): { start: string; end: string } {
  const base = { start: store?.defaultOpen ?? "10:00", end: store?.defaultClose ?? "19:00" };
  if (store?.satOpen && store.satClose && new Date(`${day}T00:00:00Z`).getUTCDay() === 6) return { start: store.satOpen, end: store.satClose };
  return base;
}

/** カレンダー用の短い名前。登録してあればそれ、なければ「空白の前（苗字）」か、先頭2文字。
 *  同じ短い名前の人が複数いるとき（金子直樹・金子嵩史）は、名前の最初の1文字を足す（金子直・金子嵩）。 */
export function shortNames(people: { id: string; name: string; shortName?: string | null }[]): Map<string, string> {
  const base = (p: { name: string; shortName?: string | null }) => {
    if (p.shortName?.trim()) return p.shortName.trim();
    const n = p.name.normalize("NFKC").trim();
    const sp = n.split(/[\s\u3000]+/);
    if (sp.length > 1) return sp[0];
    return n.length <= 2 ? n : n.slice(0, 2);
  };
  const count = new Map<string, number>();
  for (const p of people) count.set(base(p), (count.get(base(p)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of people) {
    const b = base(p);
    const given = p.name.normalize("NFKC").replace(/[\s\u3000]+/g, "").slice(b.length, b.length + 1);
    out.set(p.id, (count.get(b) ?? 0) > 1 && !p.shortName?.trim() ? b + given : b);
  }
  return out;
}
