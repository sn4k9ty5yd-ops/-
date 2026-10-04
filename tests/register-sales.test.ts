import { describe, expect, it } from "vitest";
import { checkRow, monthRange, parseRegisterPaste, ratioOf, sortRows, totalsOf } from "../lib/register-sales";

const LINE = "鬼塚 祐介\t1,086,800\t28,300\t0\t1,058,500\t57,100\t0\t0\t57,100\t1,143,900\t28,300\t0\t1,115,600\t13.1%\t1\t0\t76\t8\t0\t85";

describe("レジ売上の計算と貼り付け", () => {
  it("レジの1行を読める（売上比率あり）。計算も合う", () => {
    const { rows } = parseRegisterPaste(LINE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "鬼塚 祐介", techBefore: 1086800, techDiscount: 28300, techTotal: 1058500, goodsTotal: 57100, allTotal: 1115600, newCount: 1, fixedCount: 76, gobusataCount: 8, totalCount: 85 });
    expect(checkRow(rows[0])).toEqual([]);
  });
  it("売上比率なし（18個）でも、空白区切りでも読める。名前の空白もOK。合計の行や見出しは読まない", () => {
    const t = "ATENA 天神 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n合計 8,361,200 452,665 0 7,908,535 591,050 0 0 591,050 8,952,250 452,665 0 8,499,585 - 37 9 526 62 0 634\nスタッフ 技術 商品";
    const r = parseRegisterPaste(t);
    expect(r.rows.map((x) => x.name)).toEqual(["ATENA 天神"]);
  });
  it("数が合わない行は、読まずに知らせる", () => {
    const r = parseRegisterPaste("山田 1 2 3");
    expect(r.rows).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
  });
  it("合わない数字を見つける", () => {
    const { rows } = parseRegisterPaste(LINE.replace("1,058,500", "1,058,000"));
    expect(checkRow(rows[0])).toEqual(expect.arrayContaining(["技術の合計"]));
  });
  it("合計・売上比率・並べかえ・月の範囲", () => {
    const a = parseRegisterPaste(LINE).rows[0];
    const b = { ...a, name: "B", allTotal: 3346800, techTotal: 0, totalCount: 10 };
    const rows = [a, b];
    expect(totalsOf(rows).allTotal).toBe(1115600 + 3346800);
    expect(ratioOf(a, rows)).toBe(25);
    expect(sortRows(rows, "all").map((r) => r.name)).toEqual(["B", "鬼塚 祐介"]);
    expect(sortRows(rows, "customers").map((r) => r.name)).toEqual(["鬼塚 祐介", "B"]);
    expect(sortRows(rows, "order").map((r) => r.name)).toEqual(["鬼塚 祐介", "B"]);
    expect(monthRange("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthRange("2028-02").end).toBe("2028-02-29");
  });
});

describe("レジ売上のエクセル", () => {
  it("レジと同じ見出し・数字・合計で、エクセルのファイルができる", async () => {
    const { buildRegisterXlsx } = await import("../lib/register-xlsx");
    const XLSX = await import("xlsx");
    const rows = parseRegisterPaste(LINE).rows;
    const bytes = await buildRegisterXlsx(rows, { storeName: "ATENA天神", month: "2026-09", start: "2026-09-01", end: "2026-09-30", days: 28, confirmed: true });
    const wb = XLSX.read(bytes, { type: "array" });
    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets["2026-09"], { header: 1 });
    expect(String(grid[0][0])).toContain("ATENA天神");
    expect(String(grid[1][0])).toContain("稼働日数：28日");
    expect(grid[3][0]).toBe("スタッフ");
    expect(grid[3][1]).toBe("技術");
    expect(grid[4].slice(1, 5)).toEqual(["値引前", "値引", "消費税", "合計"]);
    expect(grid[5][0]).toBe("鬼塚 祐介");
    expect(grid[5][1]).toBe(1086800);
    expect(grid[5][12]).toBe(1115600);
    expect(grid[6][0]).toBe("合計");
    expect(grid[6][4]).toBe(1058500);
  });
});
