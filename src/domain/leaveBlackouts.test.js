import { describe, expect, it } from 'vitest'
import {
  getNoticesForDate,
  legacyBlackoutToNotice,
  normalizeBlackoutNotice,
  normalizeLeaveBlackout,
  removeLeaveBlackout,
  upsertBlackoutNotice,
  upsertLeaveBlackout,
} from './leaveBlackouts.js'
import { getVisaJourneyProgress, normalizeVisaJourney } from './visaJourney.js'

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

describe('blackout notices (period + full announcement text)', () => {
  const notice = {
    id: 'notice-1',
    startDate: '2026-12-20',
    endDate: '2027-01-05',
    title: '年底旺季禁休',
    body: '各位同仁：\r\n12/20 至 1/5 為旺季，\n暫停所有休假申請。',
  }

  it('keeps multi-line text and validates the period', () => {
    const saved = normalizeBlackoutNotice(notice)
    expect(saved.body).toBe('各位同仁：\n12/20 至 1/5 為旺季，\n暫停所有休假申請。')
    expect(() => normalizeBlackoutNotice({ ...notice, endDate: '2026-12-01' })).toThrow('不可早於')
    expect(() => normalizeBlackoutNotice({ ...notice, body: 'x'.repeat(5001) })).toThrow()
    expect(() => normalizeBlackoutNotice({ ...notice, id: '../x' })).toThrow()
  })

  it('finds every notice covering a date, including legacy single-day blackouts', () => {
    const items = upsertBlackoutNotice(
      [legacyBlackoutToNotice({ date: '2026-12-24', reason: '舊公告' })],
      normalizeBlackoutNotice(notice),
    )
    expect(getNoticesForDate(items, '2026-12-24').map((item) => item.title)).toEqual([
      '年底旺季禁休',
      '舊公告',
    ])
    expect(getNoticesForDate(items, '2027-01-06')).toEqual([])
  })

  it('does not change visa progress or pay', () => {
    const records = [
      { id: 1, workDate: '2026-12-21', shiftType: 'normal', paidMinutes: 480, grossPay: 250 },
    ]
    const settings = normalizeVisaJourney({
      goal: 'SECOND',
      subclass: '417',
      stage: 'FIRST',
      stayUntil: '2027-06-30',
      workStart: '2026-12-21',
    })
    const before = /** @type {any} */ (
      getVisaJourneyProgress({ settings, records, today: '2026-12-21' })
    )
    upsertBlackoutNotice([], normalizeBlackoutNotice(notice))
    const after = /** @type {any} */ (
      getVisaJourneyProgress({ settings, records, today: '2026-12-21' })
    )
    expect(after.creditedDays).toBe(before.creditedDays)
    expect(records[0].grossPay).toBe(250)
  })
})
