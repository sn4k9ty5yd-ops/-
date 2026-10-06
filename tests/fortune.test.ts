import { describe, expect, it } from "vitest";
import { compatibility, fortune, zodiacOf } from "../lib/fortune";

describe("占い（お楽しみ）", () => {
  it("誕生日から、星座がきまる", () => {
    expect(zodiacOf(3, 21)).toBe("aries"); expect(zodiacOf(3, 20)).toBe("pisces");
    expect(zodiacOf(12, 25)).toBe("capricorn"); expect(zodiacOf(1, 10)).toBe("capricorn"); expect(zodiacOf(1, 20)).toBe("aquarius");
    expect(zodiacOf(8, 15)).toBe("leo"); expect(zodiacOf(11, 30)).toBe("sagittarius");
  });
  it("同じ人・同じ日は同じ結果。日がかわると、かわる。星は1〜5", () => {
    const a = fortune("2026-10-05", "leo", "ENFP");
    expect(fortune("2026-10-05", "leo", "ENFP")).toEqual(a);
    expect(JSON.stringify(fortune("2026-10-06", "leo", "ENFP"))).not.toBe(JSON.stringify(a));
    for (const v of Object.values(a.stars)) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(5); }
    expect(a.luckyNumber).toBeGreaterThanOrEqual(1);
  });
  it("相性は、順番をかえても同じ。0〜100の範囲", () => {
    expect(compatibility("ENFP", "ISTJ")).toEqual(compatibility("ISTJ", "ENFP"));
    const c = compatibility("INFJ", "INFJ"); expect(c.score).toBeGreaterThanOrEqual(78); expect(c.score).toBeLessThanOrEqual(99);
  });
});

import { attendanceLines, sortRoster } from "../lib/shift-ui";
describe("出勤簿の並びと5段", () => {
  it("永尾→中嶋→成田→金子直→松村の順、あとは元の順", () => {
    const n = ["A", "松村 光留", "金子 直樹", "成田 和樹", "中嶋", "永尾", "B"].map((name) => ({ name }));
    expect(sortRoster(n).map((x) => x.name)).toEqual(["永尾", "中嶋", "成田 和樹", "金子 直樹", "松村 光留", "A", "B"]);
  });
  it("10-19は 休憩1:00・実働8:00", () => {
    expect(attendanceLines({ kind: "work", start: "10:00", end: "19:00" } as never)).toEqual(["出勤", "10:00", "19:00", "1:00", "8:00"]);
    expect(attendanceLines({ kind: "paid" } as never)[0]).toBe("有給");
  });
});
