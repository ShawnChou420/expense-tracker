import { formatLocalDate, getMonthRange, isDateInRange, parseLocalDate } from '../domain/date.js'

export function recordsInMonth(records, monthKey) {
  const range = getMonthRange(monthKey)
  return range ? records.filter((record) => isDateInRange(record.workDate, range)) : []
}

export function clearRecordsInMonth(records, monthKey) {
  const range = getMonthRange(monthKey)
  return range ? records.filter((record) => !isDateInRange(record.workDate, range)) : records
}

export function getMissingScheduleDates(records, range) {
  const start = parseLocalDate(range?.start)
  const end = parseLocalDate(range?.end)
  if (!start || !end || start > end) return []
  const occupied = new Set(records.map((record) => record.workDate))
  const missing = []
  for (const date = start; date <= end; date.setDate(date.getDate() + 1)) {
    const key = formatLocalDate(date)
    if (!occupied.has(key)) missing.push(key)
  }
  return missing
}

// A calendar edit targets the selected date, never a stale editing id from another day.
export function upsertRecordForDate(records, replacement) {
  const index = records.findIndex((record) => record.workDate === replacement.workDate)
  if (index === -1) return [replacement, ...records]

  return records.map((record, recordIndex) =>
    recordIndex === index ? { ...replacement, id: record.id } : record,
  )
}

export function nextRecordId(records, now = Date.now()) {
  return records.reduce((next, record) => {
    const id = Number(record.id)
    return Number.isFinite(id) ? Math.max(next, id + 1) : next
  }, now)
}

export function ensureUniqueRecordIds(records) {
  const seen = new Set()
  let nextId = nextRecordId(records)
  return records.map((record) => {
    const key = String(record.id)
    if (!seen.has(key)) {
      seen.add(key)
      return record
    }
    const updated = { ...record, id: nextId++ }
    seen.add(String(updated.id))
    return updated
  })
}
