export function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` // YYYY-MM-DD
}

export function parseLocalDate(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText)) // YYYY-MM-DD
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) //回傳年月日
  return formatLocalDate(date) === dateText ? date : null
}

export function getWeekRange(referenceDate) {
  const date =
    typeof referenceDate === 'string' ? parseLocalDate(referenceDate) : new Date(referenceDate)
  if (!date || Number.isNaN(date.getTime())) return null
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start: formatLocalDate(start), end: formatLocalDate(end) }
}

export function isDateInRange(dateText, range) {
  return Boolean(range && dateText >= range.start && dateText <= range.end)
}
