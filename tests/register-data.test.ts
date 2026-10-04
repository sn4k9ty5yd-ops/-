import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRow, parseRegisterPaste, totalsOf } from "../lib/register-sales";

describe("ATENA 2026年9月のレジ売上（写真から書き起こしたもの）", () => {
  const text = readFileSync("docs/register_atena_2026-09.tsv", "utf8");
  const { rows, skipped } = parseRegisterPaste(text);
  it("全員の行が読めて、どの行も数字の関係が合う", () => {
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(17);
    for (const r of rows) expect(checkRow(r), r.name).toEqual([]);
  });
  it("合計が、レジの「合計」の行と一致する", () => {
    const t = totalsOf(rows);
    expect(t).toMatchObject({ techBefore: 8361200, techDiscount: 452665, techTotal: 7908535, goodsBefore: 591050, goodsTotal: 591050, allBefore: 8952250, allDiscount: 452665, allTotal: 8499585, newCount: 37, repeatCount: 9, fixedCount: 526, gobusataCount: 62, guestCount: 0, totalCount: 634 });
  });
});
