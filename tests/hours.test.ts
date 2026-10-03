import { describe, expect, it } from "vitest";
import { calcHours, DEFAULT_BREAK_RULE, fmt, validateBreakRule } from "../lib/hours";

const show = (s: string, e: string, r = DEFAULT_BREAK_RULE) => { const h = calcHours(s, e, r); return [fmt(h.breakMin), fmt(h.work)]; };

describe("初期設定（上限8時間・段階なし）", () => {
  it("10:00-19:00 → 休憩1:00・実働8:00", () => expect(show("10:00", "19:00")).toEqual(["1:00", "8:00"]));
  it("10:00-20:00 → 休憩2:00・実働8:00", () => expect(show("10:00", "20:00")).toEqual(["2:00", "8:00"]));
  it("8時間以内は休憩なし", () => {
    expect(show("10:00", "18:00")).toEqual(["0:00", "8:00"]);
    expect(show("12:00", "16:30")).toEqual(["0:00", "4:30"]);
  });
});

describe("オフィスが変更したルール", () => {
  const legal = { capMinutes: 480, tiers: [{ overMinutes: 360, breakMinutes: 45 }, { overMinutes: 480, breakMinutes: 60 }] };
  it("6時間を超えたら45分、8時間を超えたら60分", () => {
    expect(show("10:00", "16:00", legal)).toEqual(["0:00", "6:00"]);   // ちょうど6時間は超えていない
    expect(show("10:00", "17:00", legal)).toEqual(["0:45", "6:15"]);
    expect(show("10:00", "18:00", legal)).toEqual(["0:45", "7:15"]);
    expect(show("10:00", "19:00", legal)).toEqual(["1:00", "8:00"]);
    expect(show("10:00", "20:00", legal)).toEqual(["2:00", "8:00"]);   // 上限8時間も効く
  });
  it("上限なし（null）にすると、在店時間がそのまま実働（段階の休憩だけ引く）", () => {
    expect(show("10:00", "20:00", { capMinutes: null, tiers: [] })).toEqual(["0:00", "10:00"]);
    expect(show("10:00", "20:00", { capMinutes: null, tiers: [{ overMinutes: 0, breakMinutes: 30 }] })).toEqual(["0:30", "9:30"]);
  });
  it("休憩が在店時間を超えることはない", () => {
    expect(show("10:00", "10:20", { capMinutes: null, tiers: [{ overMinutes: 0, breakMinutes: 60 }] })).toEqual(["0:20", "0:00"]);
  });
});

describe("設定値の検査", () => {
  it("正しい設定は通る", () => expect(validateBreakRule(DEFAULT_BREAK_RULE)).toBeNull());
  it("おかしな値は日本語のメッセージで断る", () => {
    expect(validateBreakRule({ capMinutes: 10, tiers: [] })).toMatch(/上限/);
    expect(validateBreakRule({ capMinutes: 480, tiers: [{ overMinutes: 360, breakMinutes: 999 }] })).toMatch(/休憩/);
    expect(validateBreakRule({ capMinutes: 480, tiers: [{ overMinutes: 360, breakMinutes: 30 }, { overMinutes: 360, breakMinutes: 45 }] })).toMatch(/同じ/);
    expect(validateBreakRule({ capMinutes: 480, tiers: [{ overMinutes: -1, breakMinutes: 30 }] })).toMatch(/超えたら/);
  });
});
