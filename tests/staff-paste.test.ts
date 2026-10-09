import { describe, expect, it } from "vitest";
import { parseLevel, parseStaffPaste } from "../lib/staff-paste";

const stores = [{ id: "s1", name: "ATENA" }, { id: "s2", name: "ATENA六本松" }, { id: "s3", name: "ATENA AVEDA SAKURAMACHI" }];
const admin = { canAssignLevel: true }, mgr = { canAssignLevel: false, defaultStoreId: "s1" };

describe("レベルの言葉", () => {
  it("数字・日本語どちらも読める", () => {
    expect([parseLevel("1"), parseLevel("スタッフ"), parseLevel("シフト担当"), parseLevel("店長"), parseLevel("オフィス"), parseLevel("管理者"), parseLevel("４")]).toEqual([1, 1, 2, 3, 4, 4, 4]);
    expect(parseLevel("鬼塚さん")).toBeNull();
  });
});

describe("スタッフの貼り付け", () => {
  it("4列（名前・社員番号・お店・レベル）。見出し行は飛ばす。全角の数字も読める", () => {
    const r = parseStaffPaste("名前\t社員番号\tお店\tレベル\n大坪\t１００３\tATENA\tスタッフ\n山田\t2002\tATENA六本松\tシフト担当\n", stores, admin);
    expect(r.skippedHeader).toBe(true);
    expect(r.rows.map((x) => [x.name, x.employeeCode, x.storeId, x.level, x.error])).toEqual([["大坪", "1003", "s1", 1, null], ["山田", "2002", "s2", 2, null]]);
  });
  it("カンマ区切り・お店の名前の全角/半角/空白のゆれは気にしない", () => {
    const r = parseStaffPaste("永尾,1004,ＡＴＥＮＡ六本松", stores, admin);
    expect(r.rows[0]).toMatchObject({ storeId: "s2", level: 1, error: null });
    expect(parseStaffPaste("太郎\t1\tATENA AVEDA SAKURAMACHI", stores, admin).rows[0].storeId).toBe("s3");
  });
  it("お店を省くと、選んだお店になる。3列目がレベルの言葉なら、レベルとして読む", () => {
    const r = parseStaffPaste("花子\t10\n次郎\t11\t店長", stores, { canAssignLevel: true, defaultStoreId: "s2" });
    expect(r.rows.map((x) => [x.storeId, x.level, x.error])).toEqual([["s2", 1, null], ["s2", 3, null]]);
  });
  it("おかしな行は、行ごとにやさしい理由をつける（ほかの行は読む）", () => {
    const r = parseStaffPaste("A\t1\tATENA\nB\t\tATENA\n\t3\tATENA\nC\t4\tなぞの店\nD\t5\tATENA\t鬼塚さん\nE\t1\tATENA\nF\t6-あ\tATENA\n", stores, admin);
    expect(r.rows.map((x) => x.error)).toEqual([
      null, "社員番号がありません", "名前がありません", "お店「なぞの店」が見つかりません", "レベル「鬼塚さん」が読めません（スタッフ・シフト担当・店長・管理者・表示専用）",
      "同じ社員番号が、この表の中に2つあります", "社員番号は、英数字（20文字まで）にしてください",
    ]);
  });
  it("店長（レベルを決められない人）は、スタッフより上のレベルを入れられない", () => {
    const r = parseStaffPaste("A\t1\tATENA\t店長\nB\t2\tATENA\tスタッフ", stores, mgr);
    expect(r.rows.map((x) => x.error)).toEqual(["スタッフより上のレベルを決められるのは、管理者だけです", null]);
  });
  it("メールアドレスの列は無視する（見出しがある表）。列の順番が違っても、見出しで読む", () => {
    const r = parseStaffPaste("社員番号\t名前\tメールアドレス\t店舗\n1003\t大坪\totsubo@example.com\tATENA\n1004\t永尾\tnagao@example.com\tATENA\n", stores, admin);
    expect(r.skippedHeader).toBe(true);
    expect(r.rows.map((x) => [x.name, x.employeeCode, x.storeId, x.level, x.error])).toEqual([["大坪", "1003", "s1", 1, null], ["永尾", "1004", "s1", 1, null]]);
  });
  it("メールアドレスの列は無視する（見出しがない表。名前・社員番号・メール）", () => {
    const r = parseStaffPaste("大坪\t1003\totsubo@example.com\n永尾\t1004\tnagao@example.com", stores, { canAssignLevel: false, defaultStoreId: "s1" });
    expect(r.rows.map((x) => [x.name, x.employeeCode, x.storeId, x.error])).toEqual([["大坪", "1003", "s1", null], ["永尾", "1004", "s1", null]]);
  });
  it("見出しに「レベル」「メール」がある表：レベルは読み、メールは読まない", () => {
    const r = parseStaffPaste("氏名,社員番号,メール,レベル,所属\n店長太郎,1001,t@example.com,店長,ATENA", stores, admin);
    expect(r.rows[0]).toMatchObject({ name: "店長太郎", employeeCode: "1001", level: 3, storeId: "s1", error: null });
  });
  it("「表示専用」は、お店のiPadの、見るだけのアカウント（レベル1）。作れるのは管理者だけ", () => {
    const r = parseStaffPaste("ATENA iPad\t57\tATENA\t表示専用\n六本松 iPad,58,ATENA六本松,iPad", stores, admin);
    expect(r.rows.map((x) => [x.level, x.displayOnly, x.error])).toEqual([[1, true, null], [1, true, null]]);
    expect(parseStaffPaste("端末\t59\tATENA\t表示専用", stores, mgr).rows[0].error).toBe("表示専用のアカウントを作れるのは、管理者だけです");
    expect(parseStaffPaste("端末\t60\t表示専用", stores, { canAssignLevel: true, defaultStoreId: "s2" }).rows[0]).toMatchObject({ storeId: "s2", displayOnly: true, error: null });
  });
});
