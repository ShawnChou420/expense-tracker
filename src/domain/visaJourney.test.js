import { describe, expect, it } from 'vitest'
import {
  addDays,
  getRequiredWorkDays,
  getVisaJourneyProgress,
  normalizeVisaJourney,
  validateVisaJourney,
} from './visaJourney.js'
import { applyBatchLeave, createLeaveRecord, planBatchLeave } from './leaveTypes.js'
import { createEmptyWorkProfile, createShiftTemplate } from './workProfile.js'
import { parseLocalDate } from './date.js'

/** 測試用：結果一定存在 @param {Parameters<typeof getVisaJourneyProgress>[0]} input @returns {any} */
const progress = (input) => getVisaJourneyProgress(input)

const profile = (() => {
  const base = createEmptyWorkProfile()
  const shift = createShiftTemplate('day', { name: '日班', startTime: '07:00', endTime: '15:30' })
  return {
    ...base,
    shiftTemplates: [shift],
    weekPlan: { 1: 'day', 2: 'day', 3: 'day', 4: 'day', 5: 'day' },
  }
})()

let nextId = 1
const work = (workDate, extra = {}) => ({
  id: nextId++,
  workDate,
  startTime: '07:00',
  endTime: '15:30',
  shiftType: 'normal',
  paidMinutes: 480,
  grossPay: 250,
  ...extra,
})

/** 依每週一到五產生工作紀錄 */
function weekdays(from, to, extra = {}) {
  const records = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = /** @type {Date} */ (parseLocalDate(date)).getDay()
    if (day >= 1 && day <= 5) records.push(work(date, extra))
  }
  return records
}

const settings = (overrides = {}) =>
  normalizeVisaJourney({
    goal: 'SECOND',
    subclass: '417',
    stage: 'FIRST',
    stayUntil: '2027-06-30',
    workStart: '2026-08-03',
    started: true,
    ...overrides,
  })

describe('visa journey settings', () => {
  it('keeps only valid values', () => {
    expect(normalizeVisaJourney({ goal: 'FOURTH', subclass: '999', stayUntil: 'x' })).toMatchObject(
      {
        goal: null,
        subclass: null,
        stayUntil: null,
      },
    )
  })

  it('needs only the goal when not tracking', () => {
    expect(validateVisaJourney(normalizeVisaJourney({ goal: 'NONE' }))).toBeNull()
    expect(validateVisaJourney(normalizeVisaJourney({ goal: 'SECOND' }))).toMatch('417')
    expect(validateVisaJourney(settings({ workStart: '2027-08-01' }))).toMatch('不可晚於')
    expect(validateVisaJourney(settings())).toBeNull()
  })

  it('converts the official calendar minimum into full-time work days', () => {
    expect(getRequiredWorkDays(88)).toBe(63)
    expect(getRequiredWorkDays(179)).toBe(128)
  })

  it('returns nothing when the user does not track a visa', () => {
    expect(progress({ settings: settings({ goal: 'NONE' }), today: '2026-11-16' })).toBeNull()
  })
})

describe('getVisaJourneyProgress', () => {
  it('second visa: counts weekday work and treats unscheduled weekends as rest days', () => {
    const records = weekdays('2026-08-03', '2026-08-30')
    const result = progress({
      settings: settings(),
      records,
      profile,
      today: '2026-08-30',
    })
    expect(result.label).toBe('集二簽')
    expect(result.counts.actualDays).toBe(20)
    expect(result.counts.restDays).toBe(8)
    expect(result.counts.missingDays).toBe(0)
    expect(result.creditedDays).toBe(20)
    expect(result.remainingDays).toBe(43)
    expect(result.status).toBe('IN_PROGRESS')
    // 依最近 4 週推算，且不早於 88 個日曆天的最低期間
    expect(result.estimate.basis).toBe('RECENT_RATE')
    expect(result.estimate.date >= addDays('2026-08-03', 87)).toBe(true)
  })

  it('third visa needs 179 calendar days and 128 work days', () => {
    const result = progress({
      settings: settings({ goal: 'THIRD', stage: 'SECOND' }),
      records: weekdays('2026-08-03', '2026-08-14'),
      profile,
      today: '2026-08-14',
    })
    expect(result.label).toBe('集三簽')
    expect(result.requiredWorkDays).toBe(128)
    expect(result.creditedDays).toBe(10)
    // 只有 12 天資料：不顯示完成日
    expect(result.estimate.date).toBeNull()
    expect(result.estimate.reason).toMatch('資料不足')
  })

  it('never finishes earlier than the minimum calendar period even with enough work days', () => {
    // 每天都上班：63 天就夠工作天，但 88 個日曆天還沒滿
    const records = []
    for (let date = '2026-08-03'; date <= '2026-10-04'; date = addDays(date, 1))
      records.push(work(date))
    const result = progress({
      settings: settings(),
      records,
      profile,
      today: '2026-10-04',
    })
    expect(result.remainingDays).toBe(0)
    expect(result.calendarMinimumMet).toBe(false)
    expect(result.status).toBe('IN_PROGRESS')
    expect(result.estimate.date).toBe(addDays('2026-08-03', 87))
  })

  it('separates historical, actual, leave and missing days', () => {
    const records = [
      ...weekdays('2026-08-03', '2026-08-07', { source: 'HISTORICAL_USER_CONFIRMED' }),
      work('2026-08-10'),
      createLeaveRecord({ id: 900, workDate: '2026-08-11', leaveType: 'SICK' }),
      createLeaveRecord({ id: 901, workDate: '2026-08-12', leaveType: 'PERSONAL' }),
      createLeaveRecord({ id: 902, workDate: '2026-08-13', leaveType: 'HOLIDAY' }),
      // 08-14（週五）沒有紀錄
    ]
    const result = progress({
      settings: settings(),
      records,
      profile,
      today: '2026-08-14',
    })
    expect(result.counts.historicalDays).toBe(5)
    expect(result.counts.actualDays).toBe(1)
    // 病假、事假、Holiday 一律無薪，不計入工作天
    expect(result.counts.unpaidLeaveDays).toBe(3)
    expect(result.counts.missingDays).toBe(1)
    expect(result.creditedDays).toBe(6)
    expect(result.hasHistory).toBe(true)
    const codes = result.reviewItems.map((item) => item.code)
    expect(codes).toContain('MISSING_RECORDS')
  })

  it('credits short days proportionally and flags them for review', () => {
    const records = [
      ...weekdays('2026-08-03', '2026-08-06'),
      work('2026-08-07', { paidMinutes: 240 }),
    ]
    const result = progress({
      settings: settings(),
      records,
      profile,
      today: '2026-08-07',
    })
    expect(result.counts.partialDays).toBe(1)
    expect(result.creditedDays).toBe(4.5)
    expect(result.reviewItems.map((item) => item.code)).toContain('PARTIAL_DAYS')
  })

  it('counts a calendar day only once and does not count future or out-of-visa work', () => {
    const records = [work('2026-08-03'), work('2026-08-03'), work('2026-08-04'), work('2026-12-01')]
    const result = progress({
      settings: settings({ stayUntil: '2026-08-31' }),
      records,
      profile,
      today: '2026-11-16',
    })
    expect(result.counts.actualDays).toBe(2)
    expect(result.counts.plannedDays).toBe(0)
    expect(result.reviewItems.map((item) => item.code)).toContain('VISA_ENDED')

    const future = progress({
      settings: settings(),
      records,
      profile,
      today: '2026-11-16',
    })
    expect(future.counts.plannedDays).toBe(1)
  })

  it('flags work done on a different visa stage', () => {
    const result = progress({
      settings: settings({ goal: 'THIRD', stage: 'FIRST' }),
      records: [],
      profile,
      today: '2026-08-10',
    })
    expect(result.reviewItems.map((item) => item.code)).toContain('STAGE_MISMATCH')
    expect(result.status).toBe('NOT_STARTED')
  })

  it('uses payslips only as evidence and never double counts', () => {
    const records = weekdays('2026-08-03', '2026-08-07', { source: 'HISTORICAL_USER_CONFIRMED' })
    const payslip = {
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
      grossCents: 125000,
      items: [{ type: 'BASE_PAY', hours: 40 }],
    }
    const result = progress({
      settings: settings(),
      records,
      payslips: [payslip, { ...payslip }], // 同一期間重複
      profile,
      today: '2026-08-09',
    })
    expect(result.creditedDays).toBe(5)
    expect(result.payslip).toEqual({ supportedDays: 5, checkedPayslips: 1 })
  })

  it('reports payslip periods without schedule or with very different hours', () => {
    const result = progress({
      settings: settings(),
      records: weekdays('2026-08-10', '2026-08-14'),
      payslips: [
        {
          periodStart: '2026-08-03',
          periodEnd: '2026-08-09',
          items: [{ type: 'BASE_PAY', hours: 38 }],
        },
        {
          periodStart: '2026-08-10',
          periodEnd: '2026-08-16',
          items: [{ type: 'BASE_PAY', hours: 20 }],
        },
      ],
      profile,
      today: '2026-08-16',
    })
    const codes = result.reviewItems.map((item) => item.code)
    expect(codes).toContain('PAYSLIP_WITHOUT_SCHEDULE')
    expect(codes).toContain('HOURS_MISMATCH')
    // 薪資單不會變成出勤日期
    expect(result.counts.actualDays).toBe(5)
    expect(result.payslip.supportedDays).toBe(0)
  })
})

describe('batch leave', () => {
  const records = [
    work('2026-10-20'),
    createLeaveRecord({ id: 50, workDate: '2026-10-21', leaveType: 'SICK' }),
  ]
  const dates = ['2026-10-20', '2026-10-21', '2026-10-22']

  it('finds conflicts with real work', () => {
    const plan = planBatchLeave(records, dates)
    expect(plan.create).toEqual(['2026-10-22'])
    expect(plan.updateLeave.map((record) => record.workDate)).toEqual(['2026-10-21'])
    expect(plan.conflicts.map((record) => record.workDate)).toEqual(['2026-10-20'])
  })

  it('skips real work by default and never removes it', () => {
    let id = 100
    const result = applyBatchLeave(records, dates, { leaveType: 'HOLIDAY', nextId: () => id++ })
    expect(result.find((record) => record.workDate === '2026-10-20').shiftType).toBe('normal')
    expect(result.find((record) => record.workDate === '2026-10-21').leaveType).toBe('HOLIDAY')
    expect(result.find((record) => record.workDate === '2026-10-22')).toMatchObject({
      shiftType: 'leave',
      leaveType: 'HOLIDAY',
      grossPay: 0,
      paidMinutes: 0,
    })
  })

  it('keeps the replaced shift so it can be restored when the user chooses to replace', () => {
    let id = 100
    const result = applyBatchLeave(records, dates, {
      leaveType: 'PERSONAL',
      conflictMode: 'REPLACE',
      nextId: () => id++,
    })
    const replaced = result.find((record) => record.workDate === '2026-10-20')
    expect(replaced.shiftType).toBe('leave')
    expect(replaced.replacedWork).toMatchObject({ startTime: '07:00', endTime: '15:30' })
  })

  it('never creates paid leave: leave has no pay and no hours', () => {
    const sick = createLeaveRecord({ id: 1, workDate: '2026-10-22', leaveType: 'SICK' })
    expect(sick).toMatchObject({ shiftType: 'leave', grossPay: 0, paidMinutes: 0 })
    expect('leavePaid' in sick).toBe(false)
  })
})
