import { dollarsToCents, sumCents } from './money.js'
import { getChargeReceivedCents } from './trips.js'

/**
 * 首頁「今天」卡片：今天有沒有班、幾點上下班、預估賺多少（AUD cents）。
 * @param {Array<{ workDate: string, startTime: string, endTime: string, grossPay: number, shiftType?: string, paidMinutes?: number }>} records
 * @param {string} today YYYY-MM-DD
 */
export function getTodayShift(records, today) {
  const record = records.find((item) => item.workDate === today)
  if (!record) return { status: 'none' }
  if (record.shiftType === 'leave' || !(Number(record.paidMinutes) > 0)) {
    return { status: 'leave' }
  }
  return {
    status: 'work',
    startTime: record.startTime,
    endTime: record.endTime,
    crossesMidnight: record.endTime <= record.startTime,
    grossCents: dollarsToCents(record.grossPay) ?? 0,
  }
}

/**
 * 所有行程中尚未收到的車資（不限期間）。只計還沒收齊的乘客車資。
 * @param {Array<{ charges?: Array<{ amountCents: number, payments?: Array<{ amountCents: number }>, paymentStatus?: string }> }>} trips
 */
export function getPendingFareSummary(trips) {
  const outstanding = trips
    .flatMap((trip) => trip.charges || [])
    .map((charge) => Math.max(0, charge.amountCents - getChargeReceivedCents(charge)))
    .filter((cents) => cents > 0)
  return { pendingCents: sumCents(outstanding), chargeCount: outstanding.length }
}

/**
 * 本週預估結餘＝本週預估實領 −（本週已付＋待付支出）。屬於預估，不是實際現金流。
 * @param {number} weeklyNetCents
 * @param {{ paidCents: number, plannedCents: number }} expenseSummary
 */
export function getEstimatedWeekBalance(weeklyNetCents, expenseSummary) {
  const expenseCents = expenseSummary.paidCents + expenseSummary.plannedCents
  return { expenseCents, balanceCents: weeklyNetCents - expenseCents }
}

/**
 * 「11 月 9 日 – 11 月 15 日」
 * @param {{ start: string, end: string } | null} range
 */
export function formatRangeLabel(range) {
  if (!range) return ''
  const part = (/** @type {string} */ date) =>
    `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`
  return `${part(range.start)} – ${part(range.end)}`
}

/** 分鐘 → 「32.5 小時」 */
export function formatHours(/** @type {number} */ minutes) {
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小時`
}
