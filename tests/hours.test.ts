import { describe, expect, it } from "vitest";
import { calcHours, fmt } from "../lib/hours";

describe("実働・休憩の計算（ALBUMのルール）", () => {
  it("10:00-19:00 → 休憩1:00・実働8:00", () => {
    const h = calcHours("10:00", "19:00");
    expect([fmt(h.breakMin), fmt(h.work)]).toEqual(["1:00", "8:00"]);
  });
  it("10:00-20:00 → 休憩2:00・実働8:00", () => {
    const h = calcHours("10:00", "20:00");
    expect([fmt(h.breakMin), fmt(h.work)]).toEqual(["2:00", "8:00"]);
  });
  it("8時間以内は休憩なし・在店時間がそのまま実働", () => {
    expect(calcHours("10:00", "18:00")).toEqual({ stay: 480, breakMin: 0, work: 480 });
    expect(calcHours("12:00", "16:30")).toEqual({ stay: 270, breakMin: 0, work: 270 });
  });
});
