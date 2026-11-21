// 依目前語系格式化日期、工時等顯示文字；只產生畫面字串，不改任何原始資料。
import { currentLocale, t } from './index.js'

/** 「11 月 21 日 星期六」（繁中維持原格式，其他語系用 Intl） */
export function formatLongDate(/** @type {Date} */ date) {
  const locale = currentLocale()
  if (locale === 'zh-TW') {
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 星期${weekday}`
  }
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(
    date,
  )
}

/** YYYY-MM-DD → 「11 月 9 日」 */
export function formatMonthDay(/** @type {string} */ date) {
  return t('format.monthDay', { month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) })
}

/** 「11 月 9 日 – 11 月 15 日」 */
export function formatDateRange(/** @type {{ start: string, end: string } | null} */ range) {
  return range ? `${formatMonthDay(range.start)} – ${formatMonthDay(range.end)}` : ''
}

/** 分鐘 → 「32.5 小時」 */
export function formatHoursLabel(/** @type {number} */ minutes) {
  const hours = Math.round((minutes / 60) * 10) / 10
  return t('common.hours', { count: Number.isInteger(hours) ? hours : hours.toFixed(1) })
}

/** 列表連接：繁中／日文用「、」，英文用「, 」，韓文用「, 」 */
export function joinList(/** @type {string[]} */ items) {
  return items.join(t('format.listSeparator'))
}

/** 分鐘 → 「2 小時 5 分」 */
export function formatDuration(/** @type {number} */ minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return t('format.minutes', { minutes: rest })
  return rest === 0
    ? t('format.hoursOnly', { hours })
    : t('format.hoursMinutes', { hours, minutes: rest })
}

function parseDate(/** @type {string} */ text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

/** YYYY-MM-DD → 「11/18（三）」 */
export function formatDateLabel(/** @type {string} */ dateText) {
  const date = parseDate(dateText)
  if (!date) return dateText
  const locale = currentLocale()
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: locale === 'en-AU' ? 'short' : 'narrow',
  }).format(date)
  return t('format.dateWithWeekday', { month: date.getMonth() + 1, day: date.getDate(), weekday })
}

const localDay = (/** @type {Date} */ date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** 距離開始還有多久：「2 小時 5 分後上班」「明天 07:00 上班」「11/21（五）07:00 上班」 */
export function describeStart(
  /** @type {{ start: Date, startTime: string }} */ shift,
  /** @type {Date} */ now,
) {
  const today = localDay(now)
  const tomorrow = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const day = localDay(shift.start)
  if (day === today) {
    const minutes = Math.round((shift.start.getTime() - now.getTime()) / 60000)
    return minutes < 60 * 6
      ? t('format.startsIn', { duration: formatDuration(minutes) })
      : t('format.startsTodayAt', { time: shift.startTime })
  }
  if (day === tomorrow) return t('format.startsTomorrowAt', { time: shift.startTime })
  return t('format.startsOnAt', { date: formatDateLabel(day), time: shift.startTime })
}

/** 星期縮寫：繁中「三」、日文「水」、韓文「수」、英文「Wed」 */
export function weekdayShort(/** @type {Date} */ date) {
  const locale = currentLocale()
  return new Intl.DateTimeFormat(locale, {
    weekday: locale === 'en-AU' ? 'short' : 'narrow',
  }).format(date)
}
