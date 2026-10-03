import { describe, expect, it } from "vitest";
import { periodFor, upcomingPeriods } from "../lib/periods";

describe("シフト期間", () => {
  it("16日〜翌15日: 10/20 は 10/16〜11/15", () => {
    expect(periodFor("2026-10-20", 16)).toEqual({ start: "2026-10-16", end: "2026-11-15", label: "10/16〜11/15" });
  });
  it("16日〜翌15日: 11/10 も 10/16〜11/15（前の月に属する）", () => {
    expect(periodFor("2026-11-10", 16).start).toBe("2026-10-16");
  });
  it("年またぎ: 1/5 は 12/16〜1/15", () => {
    expect(periodFor("2027-01-05", 16)).toMatchObject({ start: "2026-12-16", end: "2027-01-15" });
  });
  it("境界: 15日と16日で期間が切り替わる", () => {
    expect(periodFor("2026-10-15", 16).end).toBe("2026-10-15");
    expect(periodFor("2026-10-16", 16).start).toBe("2026-10-16");
  });
  it("1日〜末日（うるう年の2月）", () => {
    expect(periodFor("2028-02-10", 1)).toMatchObject({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("連続した期間にすき間・重なりがない", () => {
    const ps = upcomingPeriods("2026-10-20", 16, 14);
    for (let i = 1; i < ps.length; i++) {
      const prevEnd = new Date(ps[i - 1].end + "T00:00:00Z");
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(ps[i].start);
    }
  });
});
