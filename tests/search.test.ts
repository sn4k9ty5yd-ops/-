import { describe, expect, it } from "vitest";
import { searchAll, norm } from "../lib/search";
import type { Me } from "../lib/service";

const me = (o: Partial<Me> = {}) => ({ id: "u", name: "t", level: 1, displayOnly: false, ...o }) as Me;

describe("ホームの検索", () => {
  it("言葉をそろえる（ひらがな・全角・大文字）", () => { expect(norm("ＡＩ　ゆうきゅう")).toBe("ai ユウキュウ"); });
  it("画面が見つかる。ひらがなの読みでも見つかる", () => {
    expect(searchAll("棚卸し", me())[0].href).toBe("/admin/stocktake");
    expect(searchAll("ゆうきゅう", me()).some((h) => h.href === "/leave")).toBe(true);
    expect(searchAll("パスコード 変える", me())[0].href).toBe("/security");
  });
  it("使えない画面は出ない（スタッフには出勤簿・スタッフ管理は出ない）。レベルが上がると出る", () => {
    expect(searchAll("出勤簿", me()).some((h) => h.href.startsWith("/admin/"))).toBe(false);
    expect(searchAll("出勤簿", me({ level: 2 })).map((h) => h.href)).toEqual(expect.arrayContaining(["/admin/shifts", "/admin/attendance"]));
    expect(searchAll("退職", me()).some((h) => h.href === "/admin/staff")).toBe(false);
    expect(searchAll("退職", me({ level: 4 })).some((h) => h.href === "/admin/staff")).toBe(true);
    expect(searchAll("AIのカギ", me({ level: 4 })).some((h) => h.href === "/admin/ai")).toBe(false);
    expect(searchAll("AIのカギ", me({ level: 4, appOwner: true })).some((h) => h.href === "/admin/ai")).toBe(true);
  });
  it("ヘルプのやり方も探せる。空・見つからないは空", () => {
    expect(searchAll("共有 ホーム画面に追加", me()).some((h) => h.kind === "help")).toBe(true);
    expect(searchAll("", me())).toEqual([]);
    expect(searchAll("ぜんぜんない言葉xyz", me())).toEqual([]);
  });
});
