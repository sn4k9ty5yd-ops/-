import type { ShiftKind } from "./service";

/** 「休みの人だけ」を書いた文章を、シフトの休み（公休・有給）に変える。
 *  1行に1日: 「10/16 金子直樹、渡邊李凰、大田幸奈」「10/17 中嶋翔也（有給）」「10/19 店休日」
 *  名前に（有給）が付くと有給、付かなければ公休。「店休日」「全員休み」は、全員を公休にする。 */
export interface PastePerson { id: string; name: string }
export interface PasteEntry { day: string; token: string; personId: string | null; kind: Extract<ShiftKind, "holiday" | "paid"> }
export interface PasteResult { entries: PasteEntry[]; unmatched: string[]; badLines: string[] }

const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");

/** 期間(start〜end)に入る日付に、月/日を直す */
export function resolveDay(m: number, d: number, start: string, end: string): string | null {
  for (const y of [Number(start.slice(0, 4)), Number(end.slice(0, 4))]) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    if (iso >= start && iso <= end && !Number.isNaN(Date.parse(iso))) return iso;
  }
  return null;
}

export function matchPerson(token: string, roster: PastePerson[], aliases: Record<string, string> = {}): string | null {
  const t = norm(token);
  if (!t) return null;
  if (aliases[t]) return aliases[t];
  const exact = roster.filter((p) => norm(p.name) === t);
  if (exact.length === 1) return exact[0].id;
  const starts = roster.filter((p) => norm(p.name).startsWith(t));          // 「廣」→「廣茉紀」
  if (starts.length === 1) return starts[0].id;
  const inc = roster.filter((p) => norm(p.name).includes(t) && t.length >= 2);
  return inc.length === 1 ? inc[0].id : null;
}

export function parseOffPaste(text: string, roster: PastePerson[], start: string, end: string, aliases: Record<string, string> = {}): PasteResult {
  const res: PasteResult = { entries: [], unmatched: [], badLines: [] };
  const unmatched = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.normalize("NFKC").trim();
    if (!line) continue;
    const m = /^(?:(\d{1,2})\/(\d{1,2})|(\d{1,2})日?)(?:\([^)]*\))?[\s:：]*(.*)$/.exec(line);
    const day = m ? (m[1] ? resolveDay(Number(m[1]), Number(m[2]), start, end) : resolveDay(Number(start.slice(5, 7)) + (Number(m[3]) < Number(start.slice(8, 10)) ? 1 : 0), Number(m[3]), start, end) ?? resolveDay(Number(end.slice(5, 7)), Number(m[3]), start, end)) : null;
    if (!m || !day) { res.badLines.push(raw.trim()); continue; }
    const rest = m[4].trim();
    if (!rest || /^(なし|無し|-|－)$/.test(rest)) continue;
    if (/(店休日|全員休み|全員公休)/.test(rest)) { for (const p of roster) res.entries.push({ day, token: p.name, personId: p.id, kind: "holiday" }); continue; }
    for (const part of rest.split(/[、,，・\t]+|\s{2,}|\s(?=[^\s(（])/).map((x) => x.trim()).filter(Boolean)) {
      const paid = /[（(]\s*有給\s*[）)]/.test(part);
      const token = part.replace(/[（(][^）)]*[）)]/g, "").trim();
      if (!token) continue;
      const id = matchPerson(token, roster, aliases);
      if (!id) unmatched.add(token);
      res.entries.push({ day, token, personId: id, kind: paid ? "paid" : "holiday" });
    }
  }
  res.unmatched = [...unmatched];
  return res;
}
