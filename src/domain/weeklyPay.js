import { getWeekRange, isDateInRange } from './date.js'
import { dollarsToCents, sumCents } from './money.js'

/**
 * 依參考日期所在的週（週一至週日）彙總班表薪資預估。所有金額皆為 AUD cents。
 *
 * - 只加總該週的紀錄；休假紀錄不計薪。
 * - PPE 津貼以「該週至少有一個非休假班」計一次。
 * - 扣稅目前沿用單一比率（稅務級距功能另案處理）。
 * - paidMinutes／shiftCount 只計非休假的班，用於顯示「已工作幾小時、幾天班表」。
 *
 * - rateFlags：這週的班有用到「暫定費率」或「未含（費率未確認）」的加成時，列出名稱供畫面提示。
 *
 * @param {Array<{ workDate: string, grossPay: number, shiftType?: string, paidMinutes?: number, rateFlags?: { provisional?: string[], excluded?: string[] } }>} records
 * @param {string} referenceDate YYYY-MM-DD
 * @param {{ ppeAllowance?: number, withholdingTaxRate?: number }} [rates]
 */
export function getWeeklyPaySummary(records, referenceDate, rates = {}) {
  const { ppeAllowance = 0, withholdingTaxRate = 0 } = rates
  const range = getWeekRange(referenceDate)
  const weekRecords = range ? records.filter((record) => isDateInRange(record.workDate, range)) : []
  const workedRecords = weekRecords.filter((record) => record.shiftType !== 'leave')
  const shiftCents = sumCents(workedRecords.map((record) => dollarsToCents(record.grossPay) ?? 0))
  const ppeCents = workedRecords.length > 0 ? (dollarsToCents(ppeAllowance) ?? 0) : 0
  const grossCents = shiftCents + ppeCents
  const taxRate =
    Number.isFinite(withholdingTaxRate) && withholdingTaxRate > 0 ? withholdingTaxRate : 0
  const taxCents = Math.round(grossCents * taxRate)
  const paidMinutes = workedRecords.reduce(
    (total, record) => total + (Number(record.paidMinutes) > 0 ? Number(record.paidMinutes) : 0),
    0,
  )
  const unique = (/** @type {string[]} */ labels) => [...new Set(labels)]
  const rateFlags = {
    provisional: unique(workedRecords.flatMap((record) => record.rateFlags?.provisional ?? [])),
    excluded: unique(workedRecords.flatMap((record) => record.rateFlags?.excluded ?? [])),
  }
  return {
    range,
    rateFlags,
    recordCount: weekRecords.length,
    shiftCount: workedRecords.length,
    paidMinutes,
    shiftCents,
    ppeCents,
    grossCents,
    taxCents,
    netCents: grossCents - taxCents,
  }
}
