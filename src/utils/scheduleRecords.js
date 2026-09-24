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
