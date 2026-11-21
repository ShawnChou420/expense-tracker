import { isDateInRange, parseLocalDate } from './date.js'
import { getExpenseCategory, getExpenseOccurrences } from './expenses.js'
import { dollarsToCents, sumCents } from './money.js'
import { getChargeReceivedCents } from './trips.js'
import { formatCalendarAmount } from '../utils/calendarMoney.js'

/**
 * 生活日曆的「每日淨收支」。
 *
 * 目前只有「預估」模式（ESTIMATED）：
 *   每日預估淨額 = 當日預估工作收入（稅前）+ 當日車資應收 − 當日生活支出
 *
 * 口徑（避免重複計算）：
 * - 工作收入：班表上已由 useShiftCalculator 算好的 grossPay（稅前），與首頁 Dashboard 的
 *   「預估工作收入」相同；歸屬日＝班表的 workDate（跨午夜夜班算在上班那天），請假不計。
 * - 車資應收：依搭車日期（trip.date）計整趟應收；已收多少只是明細資訊，不再另外加一次。
 * - 生活支出：依支出的到期／發生日期（getExpenseOccurrences），已付與待付都算一次；
 *   付款紀錄（payments）只改變狀態，不會在付款日再扣一次。已實現投資虧損不是現金支出，不計。
 * - 發薪入帳（salary deposits）是實際入帳，不計入預估淨額，只列在明細供對照。
 *
 * 之後若要加「實際現金流」模式（ACTUAL_CASH：依收款／付款日），另寫一個函式並沿用同樣的回傳格式。
 */
export const DAILY_NET_MODES = Object.freeze({ ESTIMATED: 'ESTIMATED' })

/**
 * @typedef {object} DailyNet
 * @property {string} date
 * @property {number} workCents 預估工作收入（稅前）
 * @property {number} fareCents 車資應收
 * @property {number} expenseCents 生活支出（已付＋待付）
 * @property {number} plannedExpenseCents 其中尚未付款的部分
 * @property {number} netCents
 * @property {Array<any>} workItems
 * @property {Array<any>} fareItems
 * @property {Array<any>} expenseItems
 * @property {Array<any>} salaryDeposits 當日發薪入帳（不計入 netCents）
 */

/** @param {string} date @returns {DailyNet} */
function emptyDay(date) {
  return {
    date,
    workCents: 0,
    fareCents: 0,
    expenseCents: 0,
    plannedExpenseCents: 0,
    netCents: 0,
    workItems: [],
    fareItems: [],
    expenseItems: [],
    salaryDeposits: [],
  }
}

/**
 * 有任何會影響淨額的紀錄（班、車資、支出）才算「有資料」；只有發薪入帳不算。
 * @param {DailyNet | null | undefined} day
 */
export function hasDailyNetActivity(day) {
  return Boolean(
    day && (day.workItems.length > 0 || day.fareItems.length > 0 || day.expenseItems.length > 0),
  )
}

/**
 * 依日期整理每日預估淨額。沒有任何紀錄的日期不會出現在結果中（空狀態，不是 0 元）。
 * @param {{
 *   range: { start: string, end: string } | null,
 *   workRecords?: Array<any>,
 *   trips?: Array<any>,
 *   expenses?: Array<any>,
 *   salaryDeposits?: Array<any> | null,
 *   passengerNames?: Record<string, string>,
 * }} sources
 * @returns {Map<string, DailyNet>}
 */
export function getEstimatedDailyNet({
  range,
  workRecords = [],
  trips = [],
  expenses = [],
  salaryDeposits = null,
  passengerNames = {},
}) {
  /** @type {Map<string, DailyNet>} */
  const days = new Map()
  if (!range || !parseLocalDate(range.start) || !parseLocalDate(range.end)) return days
  const dayOf = (/** @type {string} */ date) => {
    let day = days.get(date)
    if (!day) {
      day = emptyDay(date)
      days.set(date, day)
    }
    return day
  }

  for (const record of workRecords) {
    if (!record || record.shiftType === 'leave' || !isDateInRange(record.workDate, range)) continue
    const grossCents = dollarsToCents(record.grossPay) ?? 0
    dayOf(record.workDate).workItems.push({
      id: record.id,
      startTime: record.startTime,
      endTime: record.endTime,
      grossCents,
    })
  }

  for (const trip of trips) {
    if (!trip || !isDateInRange(trip.date, range)) continue
    const charges = Array.isArray(trip.charges) ? trip.charges : []
    if (charges.length === 0) continue
    const day = dayOf(trip.date)
    for (const charge of charges) {
      const amountCents = Number.isSafeInteger(charge.amountCents) ? charge.amountCents : 0
      day.fareItems.push({
        tripId: trip.id,
        passengerId: charge.passengerId,
        passengerName: passengerNames[charge.passengerId] || '',
        tripType: trip.type,
        amountCents,
        receivedCents: Math.min(amountCents, getChargeReceivedCents(charge)),
      })
    }
  }

  for (const occurrence of getExpenseOccurrences(expenses, range)) {
    if (occurrence.category === 'INVESTMENT_LOSS') continue
    dayOf(occurrence.date).expenseItems.push({
      occurrenceId: occurrence.occurrenceId,
      sourceId: occurrence.sourceId,
      title:
        occurrence.title || getExpenseCategory(occurrence.group, occurrence.category)?.label || '',
      group: occurrence.group,
      category: occurrence.category,
      amountCents: occurrence.amountCents,
      status: occurrence.status,
    })
  }

  for (const deposit of salaryDeposits || []) {
    if (!deposit || deposit.type === 'TRANSFER' || !Number.isSafeInteger(deposit.amountCents))
      continue
    if (!isDateInRange(deposit.paidAt, range)) continue
    dayOf(deposit.paidAt).salaryDeposits.push({
      id: deposit.id,
      amountCents: deposit.amountCents,
    })
  }

  for (const day of days.values()) {
    day.workCents = sumCents(day.workItems.map((item) => item.grossCents))
    day.fareCents = sumCents(day.fareItems.map((item) => item.amountCents))
    day.expenseCents = sumCents(day.expenseItems.map((item) => item.amountCents))
    day.plannedExpenseCents = sumCents(
      day.expenseItems.filter((item) => item.status !== 'PAID').map((item) => item.amountCents),
    )
    day.netCents = day.workCents + day.fareCents - day.expenseCents
  }
  return days
}

/**
 * 日曆格上的金額文字：`+155`、`−120`、`0`。一定帶正負號（不只靠顏色），負號用 U+2212。
 * @param {number} netCents AUD cents
 * @param {number} [rate] 1 AUD = rate 顯示幣別
 * @returns {{ text: string, sign: 'positive' | 'negative' | 'zero' }}
 */
export function formatDailyNet(netCents, rate = 1) {
  const value = Math.round(((Number(netCents) || 0) / 100) * (Number(rate) || 1))
  if (value === 0) return { text: '0', sign: 'zero' }
  const absolute = Math.abs(value)
  // 日曆格很窄：十萬以上（韓元、越南盾）不顯示小數，例如 +140K
  const body =
    absolute >= 100000
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 0 }).format(
          absolute,
        )
      : formatCalendarAmount(absolute)
  return value > 0 ? { text: `+${body}`, sign: 'positive' } : { text: `−${body}`, sign: 'negative' }
}
