import { formatLocalDate, parseLocalDate } from './date.js'

/** 提早換裝打卡的分鐘數（計薪）。 */
export const PREP_MINUTES = 5

/**
 * 回傳套用提早換裝時間後的實際計薪起點。
 * 起點跨過午夜時（例如 00:02 提早 5 分鐘），日期會往前一天，
 * 讓平日／週末／國定假日的判斷落在實際上班的那一天。
 *
 * @param {string} workDate YYYY-MM-DD
 * @param {string} startTime HH:mm
 * @param {number} prepMinutes 提早的分鐘數，0 代表不套用
 * @returns {{ workDate: string, startTime: string } | null} 日期或時間無效時回傳 null
 */
export function applyPrepTime(workDate, startTime, prepMinutes) {
  const date = parseLocalDate(workDate)
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(startTime))
  if (!date || !match) return null
  const minutes = Number.isSafeInteger(prepMinutes) && prepMinutes > 0 ? prepMinutes : 0
  let startMinutes = Number(match[1]) * 60 + Number(match[2]) - minutes
  while (startMinutes < 0) {
    startMinutes += 24 * 60
    date.setDate(date.getDate() - 1)
  }
  const hours = String(Math.floor(startMinutes / 60)).padStart(2, '0')
  const mins = String(startMinutes % 60).padStart(2, '0')
  return { workDate: formatLocalDate(date), startTime: `${hours}:${mins}` }
}
