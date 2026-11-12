/**
 * 稅務相關的年度設定。數字會隨年度變動，**需以 ATO 公告確認**。
 * startYear 為所得年度的起始年（例如 2026 代表 2026-07-01 至 2027-06-30）。
 * 未列出的年度沿用最接近的較早年度設定。
 */
export const WHM_FIRST_BRACKET_LIMITS = [
  { startYear: 2025, cents: 4_500_000 },
  { startYear: 2026, cents: 4_500_000 },
]

/** @param {number} startYear */
export function getFirstBracketLimitCents(startYear) {
  const sorted = [...WHM_FIRST_BRACKET_LIMITS].sort((a, b) => a.startYear - b.startYear)
  const earlier = sorted.filter((entry) => entry.startYear <= startYear)
  return (earlier.at(-1) ?? sorted[0]).cents
}
