import { dollarsToCents } from './money.js'
import { formatLocalDate, parseLocalDate } from './date.js'

/**
 * 首頁「今天」：依現在時間挑出最適合顯示的班次。
 * 薪資直接用班表上已由 useShiftCalculator 算好的金額（grossPay、paidMinutes、smokoDeductMinutes），
 * 這裡不重新計薪。
 *
 * 班次日期（Shift Date）＝開始上班那天；跨午夜的班次結束時間落在隔天。
 * 時間一律用裝置的本地時間（new Date(年, 月, 日, 時, 分)），夏令時間由瀏覽器處理。
 */

/** @param {string} workDate @param {string} time HH:mm */
function at(workDate, time, addDays = 0) {
  const date = parseLocalDate(workDate)
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''))
  if (!date || !match) return null
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + addDays,
    Number(match[1]),
    Number(match[2]),
  )
}

/**
 * 班表 → 有實際時間的班次（排除請假、沒有計薪工時的紀錄）
 * @param {any} record
 */
export function toShift(record) {
  if (!record || record.shiftType === 'leave' || !(Number(record.paidMinutes) > 0)) return null
  const start = at(record.workDate, record.startTime)
  const crossesMidnight = String(record.endTime) <= String(record.startTime)
  const end = at(record.workDate, record.endTime, crossesMidnight ? 1 : 0)
  if (!start || !end || end <= start) return null
  return {
    workDate: record.workDate,
    startTime: record.startTime,
    endTime: record.endTime,
    crossesMidnight,
    start,
    end,
    paidMinutes: Number(record.paidMinutes) || 0,
    smokoDeductMinutes: Number(record.smokoDeductMinutes) || 0,
    smokoCount: Number(record.smokoCount) || 0,
    grossCents: dollarsToCents(record.grossPay) ?? 0,
  }
}

/**
 * 優先順序：1 正在上班 → 2 今天稍後的班 → 3 今天剛結束的班（例如夜班早上下班）→ 4 之後最近的一班。
 * 「最近完成」只看今天結束的班，避免把好幾天前的班當成今天的重點。
 * @param {any[]} records
 * @param {Date} now
 * @returns {{ kind: 'current' | 'later-today' | 'finished' | 'next' | 'leave' | 'none', shift: ReturnType<typeof toShift> }}
 */
export function getFocusShift(records, now) {
  const today = formatLocalDate(now)
  const shifts = records.map(toShift).filter((shift) => shift !== null)
  const current = shifts.find((shift) => shift.start <= now && now < shift.end)
  if (current) return { kind: 'current', shift: current }

  const upcoming = shifts
    .filter((shift) => shift.start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const laterToday = upcoming.find((shift) => formatLocalDate(shift.start) === today)
  if (laterToday) return { kind: 'later-today', shift: laterToday }

  const finished = shifts
    .filter((shift) => shift.end <= now && formatLocalDate(shift.end) === today)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0]
  if (finished) return { kind: 'finished', shift: finished }

  const onLeave = records.some(
    (record) => record.workDate === today && record.shiftType === 'leave',
  )
  if (onLeave) return { kind: 'leave', shift: upcoming[0] ?? null }
  if (upcoming[0]) return { kind: 'next', shift: upcoming[0] }
  return { kind: 'none', shift: null }
}

/**
 * 上班中「今天已賺」：班表預估稅前薪資 × 已經過的時間比例（四捨五入到 cents）。
 * 只是讓人有感的即時估計：不知道 Smoko／休息的實際時段，也不區分班內不同加成，
 * 所以按整個班的時間平均分攤；開始前是 0，下班後就是整個班的預估金額。
 * @param {{ start: Date, end: Date, grossCents: number } | null} shift toShift 的結果
 * @param {Date} now
 * @returns {{ earnedCents: number, fraction: number }}
 */
export function getEarnedSoFar(shift, now) {
  if (!shift) return { earnedCents: 0, fraction: 0 }
  const total = shift.end.getTime() - shift.start.getTime()
  const elapsed = now.getTime() - shift.start.getTime()
  const fraction = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0
  return { earnedCents: Math.round((shift.grossCents || 0) * fraction), fraction }
}

/** 分鐘 → 「6 小時 10 分」 */
export function formatDuration(/** @type {number} */ minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest} 分`
  return rest === 0 ? `${hours} 小時` : `${hours} 小時 ${rest} 分`
}

/** 距離開始還有多久：「2 小時 5 分後」「明天 07:00」「11/21（五）07:00」 */
export function describeStart(shift, now) {
  const today = formatLocalDate(now)
  const tomorrow = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const day = formatLocalDate(shift.start)
  if (day === today) {
    const minutes = Math.round((shift.start.getTime() - now.getTime()) / 60000)
    return minutes < 60 * 6 ? `${formatDuration(minutes)}後上班` : `今天 ${shift.startTime} 上班`
  }
  if (day === tomorrow) return `明天 ${shift.startTime} 上班`
  return `${formatDateLabel(day)} ${shift.startTime} 上班`
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 「11/18（三）」 */
export function formatDateLabel(/** @type {string} */ dateText) {
  const date = parseLocalDate(dateText)
  if (!date) return dateText
  return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）`
}

/** 問候語：只依時間，不評論使用者 */
/**
 * 問候語的翻譯 key（greeting.*），畫面用 t() 顯示
 * @returns {'working' | 'lateNight' | 'morning' | 'afternoon' | 'evening'}
 */
export function getGreetingKey(/** @type {Date} */ now, working = false) {
  if (working) return 'working'
  const hour = now.getHours()
  if (hour < 5) return 'lateNight'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'lateNight'
}

const GREETINGS_ZH = {
  working: '上班中，辛苦了',
  lateNight: '夜深了，記得休息',
  morning: '早安',
  afternoon: '午安',
  evening: '晚安',
}

/** 繁體中文問候語（保留給既有呼叫與測試） */
export function getGreeting(/** @type {Date} */ now, working = false) {
  return GREETINGS_ZH[getGreetingKey(now, working)]
}

/** 心情選項（顯示順序固定；只是私人紀錄，不換算成分數） */
export const MOODS = [
  { value: 'GREAT', emoji: '😊', label: '很好' },
  { value: 'OKAY', emoji: '😐', label: '普通' },
  { value: 'TIRED', emoji: '😮‍💨', label: '疲累' },
  { value: 'LOW', emoji: '😔', label: '低落' },
  { value: 'STRESSED', emoji: '😣', label: '壓力大' },
]

export const REPEAT_OPTIONS = [
  { value: 'NONE', label: '不重複' },
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKLY', label: '每週' },
  { value: 'MONTHLY', label: '每月' },
]

/**
 * 重複待辦在某一天有沒有一次（與後端 DailyTaskController.occursOn 相同規則）。
 * 每月 31 號在沒有 31 號的月份落在月底。
 * @param {'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'} repeatType
 * @param {string} start YYYY-MM-DD
 * @param {string} date YYYY-MM-DD
 */
export function occursOn(repeatType, start, date) {
  if (date < start) return false
  const first = parseLocalDate(start)
  const day = parseLocalDate(date)
  if (!first || !day) return false
  if (repeatType === 'DAILY') return true
  if (repeatType === 'WEEKLY') return first.getDay() === day.getDay()
  if (repeatType === 'MONTHLY') {
    const monthEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
    return day.getDate() === Math.min(first.getDate(), monthEnd)
  }
  return start === date
}

/** 待辦完成進度：{ done, total } */
export function getTaskProgress(/** @type {Array<{ completed: boolean }>} */ tasks) {
  return { done: tasks.filter((task) => task.completed).length, total: tasks.length }
}

/** 本地日期加減天數 */
export function addDays(/** @type {string} */ dateText, /** @type {number} */ days) {
  const date = parseLocalDate(dateText)
  if (!date) return dateText
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}
