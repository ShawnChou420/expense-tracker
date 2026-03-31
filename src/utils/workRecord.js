import { roundTo } from './number.js'

/**
 * WorkRecord 是目前每日紀錄的固定資料結構。
 * 這裡刻意保留完整欄位，避免加入本週列表、JSON 匯出、XLSX 匯出時
 * 各自組不同 shape，之後維護會比較容易出錯。
 *
 * @typedef {Object} WorkRecord
 * @property {number} id
 * @property {string} workDate
 * @property {string} startTime
 * @property {string} endTime
 * @property {number} totalMinutes
 * @property {number} smokoCount
 * @property {number} smokoDeductMinutes
 * @property {number} paidMinutes
 * @property {number} weekdayPaidMinutes
 * @property {number} saturdayPaidMinutes
 * @property {number} sundayPaidMinutes
 * @property {number} satOrdMinutes
 * @property {number} timeHalfMinutes
 * @property {number} doubleMinutes
 * @property {number} basePay
 * @property {number} casualPay
 * @property {number} shiftPay
 * @property {number} satOrdPay
 * @property {number} timeHalfPay
 * @property {number} doublePay
 * @property {number} sunOrdPay
 * @property {number} grossPay
 */

const defaultWorkRecord = {
  id: 0,
  workDate: '',
  startTime: '',
  endTime: '',
  totalMinutes: 0,
  smokoCount: 0,
  smokoDeductMinutes: 0,
  paidMinutes: 0,
  weekdayPaidMinutes: 0,
  saturdayPaidMinutes: 0,
  sundayPaidMinutes: 0,
  satOrdMinutes: 0,
  timeHalfMinutes: 0,
  doubleMinutes: 0,
  basePay: 0,
  casualPay: 0,
  shiftPay: 0,
  satOrdPay: 0,
  timeHalfPay: 0,
  doublePay: 0,
  sunOrdPay: 0,
  grossPay: 0,
}

/**
 * 將任意來源資料整理成固定的 WorkRecord。
 *
 * 假設：
 * - 若匯入的舊 JSON 缺少某些欄位，先以 0 補齊，不額外推導新規則。
 * - 金額與分鐘欄位維持既有四捨五入策略，不在這裡改薪資算法。
 *
 * @param {Partial<WorkRecord>} record
 * @returns {WorkRecord}
 */
export function normalizeWorkRecord(record = {}) {
  return {
    ...defaultWorkRecord,
    ...record,
    id: Number(record.id ?? defaultWorkRecord.id),
    totalMinutes: roundTo(Number(record.totalMinutes ?? 0), 2),
    smokoCount: Number(record.smokoCount ?? 0),
    smokoDeductMinutes: roundTo(Number(record.smokoDeductMinutes ?? 0), 2),
    paidMinutes: roundTo(Number(record.paidMinutes ?? 0), 2),
    weekdayPaidMinutes: roundTo(Number(record.weekdayPaidMinutes ?? 0), 2),
    saturdayPaidMinutes: roundTo(Number(record.saturdayPaidMinutes ?? 0), 2),
    sundayPaidMinutes: roundTo(Number(record.sundayPaidMinutes ?? 0), 2),
    satOrdMinutes: roundTo(Number(record.satOrdMinutes ?? 0), 2),
    timeHalfMinutes: roundTo(Number(record.timeHalfMinutes ?? 0), 2),
    doubleMinutes: roundTo(Number(record.doubleMinutes ?? 0), 2),
    basePay: roundTo(Number(record.basePay ?? 0), 2),
    casualPay: roundTo(Number(record.casualPay ?? 0), 2),
    shiftPay: roundTo(Number(record.shiftPay ?? 0), 2),
    satOrdPay: roundTo(Number(record.satOrdPay ?? 0), 2),
    timeHalfPay: roundTo(Number(record.timeHalfPay ?? 0), 2),
    doublePay: roundTo(Number(record.doublePay ?? 0), 2),
    sunOrdPay: roundTo(Number(record.sunOrdPay ?? 0), 2),
    grossPay: roundTo(Number(record.grossPay ?? 0), 2),
  }
}

/**
 * 依目前單日計算結果建立一筆 WorkRecord。
 *
 * 假設：
 * - WorkRecord 只負責保存當下已算出的結果，不重新推導薪資規則。
 * - 每次加入本週列表都建立新 id，沿用現有 Date.now() 行為。
 */
export function createWorkRecord({
  workDate,
  startTime,
  endTime,
  workSummary,
  paidSegmentedMinutes,
  saturdayRuleBreakdown,
  payBreakdown,
}) {
  return normalizeWorkRecord({
    id: Date.now(),
    workDate,
    startTime,
    endTime,
    totalMinutes: workSummary.totalMinutes,
    smokoCount: workSummary.smokoCount,
    smokoDeductMinutes: workSummary.smokoDeductMinutes,
    paidMinutes: workSummary.paidMinutes,
    weekdayPaidMinutes: paidSegmentedMinutes.weekdayPaidMinutes,
    saturdayPaidMinutes: paidSegmentedMinutes.saturdayPaidMinutes,
    sundayPaidMinutes: paidSegmentedMinutes.sundayPaidMinutes,
    satOrdMinutes: saturdayRuleBreakdown.satOrdMinutes,
    timeHalfMinutes: saturdayRuleBreakdown.timeHalfMinutes,
    doubleMinutes: saturdayRuleBreakdown.doubleMinutes,
    basePay: payBreakdown.basePay,
    casualPay: payBreakdown.casualPay,
    shiftPay: payBreakdown.shiftPay,
    satOrdPay: payBreakdown.satOrdPay,
    timeHalfPay: payBreakdown.timeHalfPay,
    doublePay: payBreakdown.doublePay,
    sunOrdPay: payBreakdown.sunOrdPay,
    grossPay: payBreakdown.grossPay,
  })
}
