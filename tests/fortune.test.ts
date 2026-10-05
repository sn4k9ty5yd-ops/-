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
