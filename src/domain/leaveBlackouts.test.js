import { describe, expect, it } from 'vitest'
import {
  normalizeLeaveBlackout,
  removeLeaveBlackout,
  upsertLeaveBlackout,
} from './leaveBlackouts.js'

describe('leave blackout markers', () => {
  it('keeps one announcement per date, including when the date has a work shift', () => {
    const workRecords = [{ workDate: '2026-10-02', grossPay: 215 }]
    const first = upsertLeaveBlackout([], { date: '2026-10-02', reason: '人手不足' })
    const updated = upsertLeaveBlackout(first, { date: '2026-10-02', reason: '主管公告禁休' })
    expect(updated).toEqual([{ date: '2026-10-02', reason: '主管公告禁休' }])
    expect(workRecords).toEqual([{ workDate: '2026-10-02', grossPay: 215 }])
  })

  it('sorts dates and removes only the selected announcement', () => {
    const items = upsertLeaveBlackout([{ date: '2026-11-01', reason: '' }], {
      date: '2026-10-31',
      reason: '忙碌日',
    })
    expect(items.map((item) => item.date)).toEqual(['2026-10-31', '2026-11-01'])
    expect(removeLeaveBlackout(items, '2026-10-31')).toEqual([{ date: '2026-11-01', reason: '' }])
  })

  it('rejects invalid dates and excessive notes', () => {
    expect(() => normalizeLeaveBlackout({ date: '2026-02-30' })).toThrow()
    expect(() => normalizeLeaveBlackout({ date: '2026-10-02', reason: 'x'.repeat(241) })).toThrow()
  })
})
