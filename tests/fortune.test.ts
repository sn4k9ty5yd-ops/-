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

import { attendanceLines, shiftHours, sortRoster } from "../lib/shift-ui";
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

describe("出勤簿の並び（続き）", () => {
  it("松村のあとは 廣・金子た・大田・上田・渡邊・山田", () => {
    const n = ["大坪 太郎", "山田 花", "X", "渡邊 一", "上田 二", "大田 三", "金子 崇史", "廣 茉紀", "松村 光留"].map((name) => ({ name }));
    expect(sortRoster(n).map((x) => x.name)).toEqual(["松村 光留", "廣 茉紀", "金子 崇史", "大田 三", "上田 二", "渡邊 一", "山田 花", "X", "大坪 太郎"]);
  });
});
describe("休憩を手で決める", () => {
  it("決めた休憩を使い、空なら自動", () => {
    const s = { start: "10:00", end: "19:00" };
    expect(shiftHours({ ...s, breakMin: 30 })).toMatchObject({ breakMin: 30, work: 510 });
    expect(shiftHours({ ...s, breakMin: null })).toMatchObject({ breakMin: 60, work: 480 });
    expect(attendanceLines({ kind: "work", ...s, breakMin: 0 } as never)[4]).toBe("9:00");
  });
});

describe("名簿の並び（ちがう書き方も同じ人）", () => {
  it("広・渡辺・太田・全角空白でも、決めた順に並ぶ", () => {
    const n = ["山田　花", "渡辺 一", "太田 三", "広 茉紀", "金子　直樹", "永尾"].map((name) => ({ name }));
    expect(sortRoster(n).map((x) => x.name)).toEqual(["永尾", "金子　直樹", "広 茉紀", "太田 三", "渡辺 一", "山田　花"]);
  });
});
