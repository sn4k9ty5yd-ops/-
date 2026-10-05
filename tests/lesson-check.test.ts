import { describe, expect, it } from "vitest";
import { isPassed, maxMismatch, nextAttemptNo, sheetStatus, totalOfScores } from "../lib/lesson-check";
describe("レッスンチェックの計算", () => {
  const sheet = { maxPoints: 15, passPoints: 12, maxAttempts: 3, items: [{ id: "a", active: true }, { id: "b", active: true }, { id: "c", active: true }] };
  it("合計・合格・いちばん高い点・次の回・満点のずれ", () => {
    expect(totalOfScores({ a: 5, b: 4 }, ["a", "b", "c"])).toBe(9);
    expect(isPassed(12, 12)).toBe(true); expect(isPassed(11, 12)).toBe(false);
    expect(sheetStatus(sheet, [{ attemptNo: 2, total: 13 }, { attemptNo: 1, total: 8 }])).toEqual({ passedAt: 2, best: 13, count: 2 });
    expect(sheetStatus(sheet, [])).toEqual({ passedAt: null, best: null, count: 0 });
    expect(nextAttemptNo(sheet, [{ attemptNo: 1, total: 1 }, { attemptNo: 3, total: 1 }])).toBe(2);
    expect(nextAttemptNo(sheet, [1, 2, 3].map((n) => ({ attemptNo: n, total: 1 })))).toBeNull();
    expect(maxMismatch(sheet)).toBeNull();
    expect(maxMismatch({ ...sheet, maxPoints: 50 })).toContain("15点");
  });
});
