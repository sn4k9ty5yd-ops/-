/** 名前の色: スタイリスト=赤、アシスタント1年目=緑、2年目=青、年が未設定のアシスタント=灰青、ランク未設定=なし */
export const RANK_RED = "#d70015", YEAR1_GREEN = "#12a150", YEAR2_BLUE = "#0a6cf0", YEAR_NONE = "#5b7aa8";
export function nameColor(rank: string | null | undefined, year: number | null | undefined): string | undefined {
  if (rank === "stylist") return RANK_RED;
  if (rank === "assistant") return year === 1 ? YEAR1_GREEN : year === 2 ? YEAR2_BLUE : YEAR_NONE;
  return undefined;
}
export const RANK_LEGEND: [string, string][] = [["スタイリスト＝赤", RANK_RED], ["アシスタント1年目＝緑", YEAR1_GREEN], ["アシスタント2年目＝青", YEAR2_BLUE]];
