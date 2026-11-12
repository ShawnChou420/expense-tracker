/**
 * 首頁「最近一期薪資」卡片用的重點：工作時數與平均每小時稅前。
 *
 * 時數只加總「完整時薪」的項目（基本時薪、加班，以及以完整時薪計算的週末／假日項目）；
 * Casual、夜班等「額外加給」是同一批工時再加錢，不能重複相加。
 * @param {{ grossCents: number | null, items?: Array<{ type: string, calcMethod?: string | null, hours: number | null }> }} payslip
 */
export function getPayslipHighlights(payslip) {
  const FULL_TYPES = new Set(['BASE_PAY', 'OVERTIME_1_5', 'OVERTIME_2_0'])
  const MAYBE_FULL = new Set(['SATURDAY_LOADING', 'SUNDAY_LOADING', 'PUBLIC_HOLIDAY'])
  let hours = 0
  for (const item of payslip.items ?? []) {
    if (!(Number(item.hours) > 0)) continue
    if (
      FULL_TYPES.has(item.type) ||
      (MAYBE_FULL.has(item.type) && item.calcMethod === 'FULL_RATE')
    ) {
      hours += Number(item.hours)
    }
  }
  hours = Math.round(hours * 100) / 100
  const grossCents = payslip.grossCents ?? null
  return {
    hours: hours > 0 ? hours : null,
    effectiveHourlyCents: hours > 0 && grossCents !== null ? Math.round(grossCents / hours) : null,
  }
}

/**
 * 依付款日排序，取最新一張。
 * @template {{ payDate?: string | null }} T
 * @param {T[]} payslips
 * @returns {T | null}
 */
export function getLatestPayslip(payslips) {
  return [...payslips].sort((a, b) => (b.payDate || '').localeCompare(a.payDate || ''))[0] ?? null
}
