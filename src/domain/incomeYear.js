import { formatLocalDate, isDateInRange, parseLocalDate } from './date.js'
import { dollarsToCents, sumCents } from './money.js'
import { getFirstBracketLimitCents } from './taxSettings.js'

/**
 * 澳洲所得年度：7/1 至隔年 6/30。
 * @param {string} dateText YYYY-MM-DD
 */
export function getIncomeYear(dateText) {
  const date = parseLocalDate(dateText)
  if (!date) return null
  const startYear = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1
  return {
    startYear,
    label: `${startYear}–${String(startYear + 1).slice(2)}`,
    start: `${startYear}-07-01`,
    end: `${startYear + 1}-06-30`,
  }
}

/**
 * 所得年度稅前收入累計與第一級距提醒。所有金額為 AUD cents。
 *
 * - 預估：本所得年度內、今天（含）以前的班表稅前薪資（不含 PPE）
 * - 實際：本所得年度內已記錄的薪資入帳稅前金額（有填 gross 的才算）
 * - 有實際入帳稅前資料時以實際為準，否則用班表預估
 * - 用最近 28 天（4 週）的班表平均週薪，推算何時超過級距上限
 *
 * @param {{
 *   records?: Array<{ workDate: string, grossPay: number, shiftType?: string }>,
 *   salaryDeposits?: Array<{ paidAt: string, grossCents?: number | null }> | null,
 *   today: string,
 *   limitCents?: number,
 * }} input
 */
export function getIncomeYearProgress({ records = [], salaryDeposits = null, today, limitCents }) {
  const incomeYear = getIncomeYear(today)
  if (!incomeYear) return null
  const limit = limitCents ?? getFirstBracketLimitCents(incomeYear.startYear)
  const toDate = { start: incomeYear.start, end: today }
  const worked = records.filter((record) => record.shiftType !== 'leave')
  const estimatedGrossCents = sumCents(
    worked
      .filter((record) => isDateInRange(record.workDate, toDate))
      .map((record) => dollarsToCents(record.grossPay) ?? 0),
  )
  const depositsWithGross = (salaryDeposits || []).filter((deposit) => {
    return Number.isSafeInteger(deposit.grossCents) && isDateInRange(deposit.paidAt, toDate)
  })
  const actualGrossCents =
    depositsWithGross.length > 0
      ? sumCents(depositsWithGross.map((deposit) => /** @type {number} */ (deposit.grossCents)))
      : null
  const basis = actualGrossCents !== null ? 'actual' : 'estimated'
  const ytdGrossCents = actualGrossCents ?? estimatedGrossCents

  const windowStart = parseLocalDate(today)
  windowStart?.setDate(windowStart.getDate() - 27)
  const recentWindow = { start: windowStart ? formatLocalDate(windowStart) : today, end: today }
  const recentWeeklyAverageCents = Math.round(
    sumCents(
      worked
        .filter((record) => isDateInRange(record.workDate, recentWindow))
        .map((record) => dollarsToCents(record.grossPay) ?? 0),
    ) / 4,
  )

  const remainingCents = Math.max(0, limit - ytdGrossCents)
  let projectedCrossDate = null
  if (remainingCents > 0 && recentWeeklyAverageCents > 0) {
    const date = parseLocalDate(today)
    if (date) {
      date.setDate(date.getDate() + Math.ceil(remainingCents / recentWeeklyAverageCents) * 7)
      projectedCrossDate = formatLocalDate(date)
    }
  }
  return {
    incomeYear,
    limitCents: limit,
    basis,
    ytdGrossCents,
    estimatedGrossCents,
    actualGrossCents,
    remainingCents,
    crossed: ytdGrossCents >= limit,
    percent: limit > 0 ? Math.min(100, (ytdGrossCents / limit) * 100) : 0,
    recentWeeklyAverageCents,
    projectedCrossDate,
    projectedWithinYear: projectedCrossDate !== null && projectedCrossDate <= incomeYear.end,
  }
}
