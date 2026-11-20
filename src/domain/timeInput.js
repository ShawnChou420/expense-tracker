/**
 * 上下班時間的手動輸入：寬鬆接受各種寫法，統一成 24 小時制 HH:MM。
 *
 * 17:00、1700、17 → 17:00；9、900、9:00 → 09:00；0、000、24:00 → 00:00；
 * 17.30、17：30（全形冒號）→ 17:30。超出範圍（25:00、17:60）或非數字回傳 null。
 *
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseTimeInput(text) {
  const value = String(text ?? '')
    .trim()
    .replace(/[：.．]/g, ':')
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  if (!value) return null

  let hour
  let minute
  const withColon = value.match(/^(\d{1,2}):(\d{2})$/)
  if (withColon) {
    hour = Number(withColon[1])
    minute = Number(withColon[2])
  } else if (/^\d{1,4}$/.test(value)) {
    // 1–2 位數只有小時；3–4 位數最後兩位是分鐘（900 → 9:00、1730 → 17:30）
    hour = Number(value.length <= 2 ? value : value.slice(0, -2))
    minute = value.length <= 2 ? 0 : Number(value.slice(-2))
  } else {
    return null
  }

  if (hour === 24 && minute === 0) hour = 0
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * 滾輪選擇器的分鐘選項：平常只列 5 的倍數，但目前時間若是手動輸入的其他分鐘（例如 17:07），
 * 也要保留那一個選項，打開滾輪時才不會錯位或把分鐘蓋掉。
 *
 * @param {string} currentTime HH:MM 或空字串
 * @returns {(type: string, options: Array<{ value: string }>) => Array<{ value: string }>}
 */
export function timePickerFilter(currentTime) {
  const currentMinute = /^\d{2}:\d{2}$/.test(currentTime ?? '') ? currentTime.slice(3) : null
  return (type, options) =>
    type === 'minute'
      ? options.filter((option) => Number(option.value) % 5 === 0 || option.value === currentMinute)
      : options
}
