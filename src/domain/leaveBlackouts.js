import { parseLocalDate } from './date.js'

export function normalizeLeaveBlackout(value) {
  const date = String(value?.date ?? '')
  if (!parseLocalDate(date)) throw new Error('請選擇有效日期')
  const reason = String(value?.reason ?? '').trim()
  if (reason.length > 240) throw new Error('禁休說明不可超過 240 字')
  return { date, reason }
}

export function upsertLeaveBlackout(items, value) {
  const blackout = normalizeLeaveBlackout(value)
  return [...items.filter((item) => item.date !== blackout.date), blackout].sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}

export function removeLeaveBlackout(items, date) {
  return items.filter((item) => item.date !== date)
}
