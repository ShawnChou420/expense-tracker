import { describe, expect, it } from 'vitest'
import { clearRecordsInMonth, ensureUniqueRecordIds, getMissingScheduleDates, nextRecordId, recordsInMonth, upsertRecordForDate } from './scheduleRecords.js'

describe('upsertRecordForDate', () => {
  it('filters and clears only the displayed month, including year boundaries', () => {
    const records = [
      { id: 1, workDate: '2026-12-31', remark: '保留' },
      { id: 2, workDate: '2027-01-01', shiftType: 'leave' },
      { id: 3, workDate: '2027-01-31', remark: '自訂' },
      { id: 4, workDate: '2027-02-01' },
    ]
    expect(recordsInMonth(records, '2027-01').map((record) => record.id)).toEqual([2, 3])
    expect(clearRecordsInMonth(records, '2027-01')).toEqual([records[0], records[3]])
    expect(clearRecordsInMonth(records, 'invalid')).toEqual(records)
  })

  it('fills only missing dates, preserving custom shifts, leave and remarks on repeat', () => {
    const records = [
      { workDate: '2026-09-29', remark: '自訂班' },
      { workDate: '2026-09-30', shiftType: 'leave' },
    ]
    const range = { start: '2026-09-28', end: '2026-09-30' }
    expect(getMissingScheduleDates(records, range)).toEqual(['2026-09-28'])
    expect(getMissingScheduleDates([...records, { workDate: '2026-09-28' }], range)).toEqual([])
    expect(records[0].remark).toBe('自訂班')
  })
  it('changes only the selected date and preserves its id', () => {
    const records = [
      { id: 1, workDate: '2026-09-21', grossPay: 200 },
      { id: 2, workDate: '2026-09-22', grossPay: 210 },
      { id: 3, workDate: '2026-09-23', grossPay: 220 },
    ]

    const updated = upsertRecordForDate(records, {
      id: 999,
      workDate: '2026-09-22',
      grossPay: 0,
      shiftType: 'leave',
    })

    expect(updated).toEqual([
      records[0],
      { id: 2, workDate: '2026-09-22', grossPay: 0, shiftType: 'leave' },
      records[2],
    ])
    expect(records[1].grossPay).toBe(210)
  })

  it('adds a new date without replacing another day', () => {
    const records = [{ id: 1, workDate: '2026-09-21', grossPay: 200 }]
    const added = { id: 2, workDate: '2026-09-22', grossPay: 0 }
    expect(upsertRecordForDate(records, added)).toEqual([added, records[0]])
  })

  it('allocates a unique id even when a batch is created in one millisecond', () => {
    const first = nextRecordId([], 100)
    const second = nextRecordId([{ id: first }], 100)
    expect([first, second]).toEqual([100, 101])
  })

  it('repairs duplicate ids from older exported schedules without changing pay', () => {
    const records = [
      { id: 100, workDate: '2026-09-21', grossPay: 200 },
      { id: 100, workDate: '2026-09-22', grossPay: 210 },
    ]
    const repaired = ensureUniqueRecordIds(records)
    expect(repaired.map((record) => record.workDate)).toEqual(records.map((record) => record.workDate))
    expect(repaired.map((record) => record.grossPay)).toEqual([200, 210])
    expect(new Set(repaired.map((record) => record.id)).size).toBe(2)
  })
})
