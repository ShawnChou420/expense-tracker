import { dollarsToCents } from './money.js'

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
