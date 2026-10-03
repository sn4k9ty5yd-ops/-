import { describe, expect, it } from "vitest";
import { reiwa, reiwaRange } from "../lib/era";

describe("令和表記", () => {
  it("2026年10月16日 → R8年10月16日", () => expect(reiwa("2026-10-16")).toBe("R8年10月16日"));
  it("期間: R8年10月16日〜R8年11月15日", () => expect(reiwaRange("2026-10-16", "2026-11-15")).toBe("R8年10月16日〜R8年11月15日"));
  it("年またぎ: R8年12月16日〜R9年1月15日", () => expect(reiwaRange("2026-12-16", "2027-01-15")).toBe("R8年12月16日〜R9年1月15日"));
  it("令和元年(2019)はR1。それ以前は西暦", () => { expect(reiwa("2019-05-01")).toBe("R1年5月1日"); expect(reiwa("2018-12-31")).toBe("2018年12月31日"); });
});
