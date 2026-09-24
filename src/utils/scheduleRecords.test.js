import { describe, expect, it } from 'vitest'
import { ensureUniqueRecordIds, nextRecordId, upsertRecordForDate } from './scheduleRecords.js'

describe('upsertRecordForDate', () => {
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
