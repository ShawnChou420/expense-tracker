import { describe, expect, it } from 'vitest'
import {
  HISTORY_SOURCE,
  createHistoryDrafts,
  editHistoryDrafts,
  historyDraftsToRecords,
  summarizeHistoryDrafts,
  validateHistoryRange,
} from './historyImport.js'
import { createEmptyWorkProfile, createShiftTemplate } from './workProfile.js'

const night = {
  ...createShiftTemplate('night', { name: '夜班', startTime: '22:00', endTime: '06:30' }),
  cleaningStartTime: '21:00',
  cleaningEndTime: '05:30',
}
const profile = {
  ...createEmptyWorkProfile(),
  shiftTemplates: [night],
  // 週一到週五夜班
  weekPlan: { 1: 'night', 2: 'night', 3: 'night', 4: 'night', 5: 'night' },
  smoko: { mode: 'FIXED', count: 2, minutes: 30, paid: false },
}

describe('validateHistoryRange', () => {
  it('only allows past periods up to today and a reasonable length', () => {
    expect(
      validateHistoryRange({ start: '2026-08-03', end: '2026-11-16', today: '2026-11-16' }),
    ).toBeNull()
    expect(
      validateHistoryRange({ start: '2026-11-10', end: '2026-11-01', today: '2026-11-16' }),
    ).toMatch('不可早於')
    expect(
      validateHistoryRange({ start: '2026-11-10', end: '2026-11-20', today: '2026-11-16' }),
    ).toMatch('今天')
    expect(
      validateHistoryRange({ start: '2025-01-01', end: '2026-11-16', today: '2026-11-16' }),
    ).toMatch('最多')
  })
})

describe('createHistoryDrafts', () => {
  it('follows the weekly plan and smoko setting, and never touches existing dates', () => {
    const existing = [{ workDate: '2026-08-05', shiftType: 'normal' }]
    const { drafts, skippedExisting } = createHistoryDrafts({
      records: existing,
      profile,
      start: '2026-08-03',
      end: '2026-08-09',
    })
    expect(skippedExisting).toBe(1)
    expect(drafts.map((draft) => draft.date)).not.toContain('2026-08-05')
    expect(summarizeHistoryDrafts(drafts)).toEqual({ work: 4, leave: 0, rest: 2 })
    expect(drafts[0]).toMatchObject({
      kind: 'work',
      startTime: '22:00',
      endTime: '06:30',
      smokoMode: 'MANUAL',
      smokoCount: 2,
    })
  })
})

describe('editHistoryDrafts', () => {
  const { drafts } = createHistoryDrafts({
    records: [],
    profile,
    start: '2026-10-19',
    end: '2026-10-25',
  })

  it('marks several dates as Holiday at once', () => {
    const edited = editHistoryDrafts(
      drafts,
      ['2026-10-20', '2026-10-21', '2026-10-22'],
      { kind: 'leave', leaveType: 'HOLIDAY' },
      profile,
    )
    expect(summarizeHistoryDrafts(edited)).toEqual({ work: 2, leave: 3, rest: 2 })
    expect(edited.find((draft) => draft.date === '2026-10-20'))?.toMatchObject({
      leaveType: 'HOLIDAY',
    })
  })

  it('changes times, smoko and cleaning day only for working days', () => {
    const times = editHistoryDrafts(
      drafts,
      ['2026-10-19', '2026-10-25'],
      { startTime: '23:00' },
      profile,
    )
    expect(times.find((draft) => draft.date === '2026-10-19')?.startTime).toBe('23:00')
    // 週日是休息日，不受影響
    expect(times.find((draft) => draft.date === '2026-10-25')?.startTime).toBe('')

    const smoko = editHistoryDrafts(drafts, ['2026-10-19'], { smokoMode: 'AUTO' }, profile)
    expect(smoko[0]).toMatchObject({ smokoMode: 'AUTO', smokoCount: null })
    const manual = editHistoryDrafts(
      drafts,
      ['2026-10-19'],
      { smokoMode: 'MANUAL', smokoCount: 1 },
      profile,
    )
    expect(manual[0].smokoCount).toBe(1)

    const cleaning = editHistoryDrafts(drafts, ['2026-10-19'], { isCleaningDay: true }, profile)
    expect(cleaning[0]).toMatchObject({ isCleaningDay: true, startTime: '21:00', endTime: '05:30' })
  })

  it('turns a rest day into a working day with the default shift', () => {
    const worked = editHistoryDrafts(drafts, ['2026-10-25'], { kind: 'work' }, profile)
    expect(worked.find((draft) => draft.date === '2026-10-25'))?.toMatchObject({
      kind: 'work',
      startTime: '22:00',
      endTime: '06:30',
    })
  })
})

describe('historyDraftsToRecords', () => {
  it('saves work and leave with the historical source, skips rest days and newly taken dates', () => {
    const { drafts } = createHistoryDrafts({
      records: [],
      profile,
      start: '2026-10-19',
      end: '2026-10-25',
    })
    const edited = editHistoryDrafts(
      drafts,
      ['2026-10-20'],
      { kind: 'leave', leaveType: 'SICK' },
      profile,
    )
    let id = 1000
    const { records, invalid } = historyDraftsToRecords(edited, {
      // 預覽開著時，使用者另外新增了 10/21 的班
      records: [{ workDate: '2026-10-21' }],
      buildWork: (draft, recordId) => ({
        id: recordId,
        workDate: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        shiftType: 'normal',
        paidMinutes: 450,
        smokoCount: draft.smokoCount,
      }),
      nextId: () => id++,
    })
    expect(invalid).toBe(0)
    expect(records.map((record) => record.workDate)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-22',
      '2026-10-23',
    ])
    expect(records.every((record) => record.source === HISTORY_SOURCE)).toBe(true)
    expect(records[0]).toMatchObject({ designatedWork: true, endTime: '06:30' })
    expect(records[1]).toMatchObject({
      shiftType: 'leave',
      leaveType: 'SICK',
      grossPay: 0,
    })
  })
})
