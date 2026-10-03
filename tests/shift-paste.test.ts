import { describe, expect, it } from "vitest";
import { matchPerson, parseOffPaste } from "../lib/shift-paste";

const roster = [
  { id: "1", name: "金子直樹" }, { id: "2", name: "金子嵩史" }, { id: "3", name: "渡邊李凰" }, { id: "4", name: "大田幸奈" }, { id: "5", name: "廣茉紀" }, { id: "6", name: "中嶋翔也" },
];
describe("休みの貼り付け", () => {
  it("日ごとの休みを読む（有給・店休日・なし・名前の省略）", () => {
    const r = parseOffPaste(`10/16 金子直樹、渡邊李凰、大田幸奈\n10/17 中嶋翔也（有給）\n10/19 店休日\n10/24 なし\n11/7 廣（有給）\nまちがい行`, roster, "2026-10-16", "2026-11-15");
    expect(r.badLines).toEqual(["まちがい行"]);
    expect(r.unmatched).toEqual([]);
    const get = (d: string) => r.entries.filter((e) => e.day === d).map((e) => `${e.personId}:${e.kind}`);
    expect(get("2026-10-16")).toEqual(["1:holiday", "3:holiday", "4:holiday"]);
    expect(get("2026-10-17")).toEqual(["6:paid"]);
    expect(get("2026-10-19")).toHaveLength(6);
    expect(get("2026-10-24")).toEqual([]);
    expect(get("2026-11-07")).toEqual(["5:paid"]);
  });
  it("期間の外の日付は読まない。名前が決まらない人は、別に出す", () => {
    const r = parseOffPaste("9/1 金子直樹\n10/20 金子た", roster, "2026-10-16", "2026-11-15");
    expect(r.badLines).toEqual(["9/1 金子直樹"]);
    expect(r.unmatched).toEqual(["金子た"]);
    expect(matchPerson("金子た", roster, { "金子た": "2" })).toBe("2");
    expect(matchPerson("金子", roster)).toBeNull();     // 2人いるので決められない
  });
});
