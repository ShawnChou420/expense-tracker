/**
 * 取得今天日期
 * 回傳格式：YYYY-MM-DD
 */
export function getTodayDate() {
  const today = new Date()

  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * 將 HH:mm 轉成總分鐘數
 * 例如：23:45 -> 1425
 */
export function parseTimeToMinutes(timeText) {
  if (!timeText) return null

  const match = timeText.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])

  return hour * 60 + minute
}

/**
 * 檢查 HH:mm 是否為合法 24 小時制
 */
export function isValidTime(timeText) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeText)
}

/**
 * 使用者輸入時，只保留時間需要的字元
 * 這裡不主動重組字串，避免輸入過程中游標跳動、
 * 或刪除分鐘後再輸入時出現數字順序顛倒。
 */
export function sanitizeTimeInput(value) {
  const cleaned = String(value)
    .replace(/[^\d:]/g, '')
    .replace(/:+/g, ':')
    .slice(0, 5)

  if (/^\d{4}$/.test(cleaned)) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`
  }

  return cleaned
}

/**
 * 使用者完成輸入後，再整理成 HH:mm
 * 例如：
 * 2    -> 2
 * 21   -> 21
 * 214  -> 21:4
 * 2143 -> 21:43
 *
 * 這裡不自動往前補 0，避免使用者刪除時游標體驗很怪
 */
export function normalizeTimeInput(value) {
  const digits = String(value).replace(/\D/g, '').slice(0, 4)

  if (!digits) return ''

  if (digits.length <= 2) return digits

  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}
