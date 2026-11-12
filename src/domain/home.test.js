import { describe, expect, it } from 'vitest'
import {
  formatHours,
  formatRangeLabel,
  getEstimatedWeekBalance,
  getPendingFareSummary,
  getTodayShift,
} from './home.js'
import { getIncomeYear, getIncomeYearProgress } from './incomeYear.js'
import { getFirstBracketLimitCents } from './taxSettings.js'

describe('getTodayShift', () => {
  const shift = {
    workDate: '2026-11-12',
    startTime: '23:50',
    endTime: '08:00',
    grossPay: 312.45,
    shiftType: 'normal',
    paidMinutes: 450,
  }

  it('returns the shift time and estimated pay for today', () => {
    expect(getTodayShift([shift], '2026-11-12')).toEqual({
      status: 'work',
      startTime: '23:50',
      endTime: '08:00',
      crossesMidnight: true,
      grossCents: 31245,
    })
  })

  it('reports leave and days without a shift', () => {
    const leave = { ...shift, shiftType: 'leave', paidMinutes: 0 }
    expect(getTodayShift([leave], '2026-11-12')).toEqual({ status: 'leave' })
    expect(getTodayShift([shift], '2026-11-13')).toEqual({ status: 'none' })
  })
})

describe('getIncomeYear', () => {
  it('starts the income year on 1 July', () => {
    expect(getIncomeYear('2026-06-30')).toMatchObject({ startYear: 2025, label: '2025–26' })
    expect(getIncomeYear('2026-07-01')).toMatchObject({
      startYear: 2026,
      start: '2026-07-01',
      end: '2027-06-30',
    })
  })
})

describe('getFirstBracketLimitCents', () => {
  it('falls back to the closest earlier configured year', () => {
    expect(getFirstBracketLimitCents(2030)).toBe(getFirstBracketLimitCents(2026))
  })
})

describe('getIncomeYearProgress', () => {
  const week = (workDate, grossPay) => ({ workDate, grossPay, shiftType: 'normal' })

  it('sums shift pay in the income year up to today and ignores other years and future shifts', () => {
    const progress = getIncomeYearProgress({
      records: [
        week('2026-06-30', 9999), // previous income year
        week('2026-07-01', 1000),
        week('2026-11-12', 500),
        week('2026-11-20', 7777), // future
      ],
      today: '2026-11-12',
      limitCents: 4_500_000,
    })
    expect(progress?.basis).toBe('estimated')
    expect(progress?.ytdGrossCents).toBe(150000)
    expect(progress?.remainingCents).toBe(4_350_000)
    expect(progress?.crossed).toBe(false)
  })

  it('uses recorded salary gross when available', () => {
    const progress = getIncomeYearProgress({
      records: [week('2026-08-01', 1000)],
      salaryDeposits: [
        { paidAt: '2026-08-05', grossCents: 120000 },
        { paidAt: '2026-08-12', grossCents: null },
      ],
      today: '2026-11-12',
      limitCents: 4_500_000,
    })
    expect(progress?.basis).toBe('actual')
    expect(progress?.ytdGrossCents).toBe(120000)
    expect(progress?.estimatedGrossCents).toBe(100000)
  })

  it('projects when the limit will be crossed from the last four weeks', () => {
    const progress = getIncomeYearProgress({
      records: [
        week('2026-10-16', 1000),
        week('2026-10-23', 1000),
        week('2026-10-30', 1000),
        week('2026-11-06', 1000),
      ],
      today: '2026-11-12',
      limitCents: 1_000_000,
    })
    expect(progress?.recentWeeklyAverageCents).toBe(100000)
    expect(progress?.remainingCents).toBe(600000)
    expect(progress?.projectedCrossDate).toBe('2026-12-24')
    expect(progress?.projectedWithinYear).toBe(true)
  })

  it('reports when the limit is already crossed', () => {
    const progress = getIncomeYearProgress({
      records: [week('2026-08-01', 2000)],
      today: '2026-11-12',
      limitCents: 100000,
    })
    expect(progress?.crossed).toBe(true)
    expect(progress?.percent).toBe(100)
    expect(progress?.projectedCrossDate).toBeNull()
  })
})

describe('getPendingFareSummary', () => {
  it('counts only charges that still have money outstanding', () => {
    const trips = [
      {
        charges: [
          { amountCents: 1000, paymentStatus: 'PENDING' },
          { amountCents: 1000, paymentStatus: 'PAID' },
          { amountCents: 1500, payments: [{ amountCents: 500 }] },
          { amountCents: 0, paymentStatus: 'PENDING' },
        ],
      },
      { charges: [] },
      {},
    ]
    expect(getPendingFareSummary(trips)).toEqual({ pendingCents: 2000, chargeCount: 2 })
  })
})

describe('getEstimatedWeekBalance', () => {
  it('subtracts paid and planned expenses from the estimated take-home pay', () => {
    expect(getEstimatedWeekBalance(115280, { paidCents: 40000, plannedCents: 23280 })).toEqual({
      expenseCents: 63280,
      balanceCents: 52000,
    })
  })
})

describe('formatting helpers', () => {
  it('formats a week range in Chinese', () => {
    expect(formatRangeLabel({ start: '2026-11-09', end: '2026-11-15' })).toBe(
      '11 月 9 日 – 11 月 15 日',
    )
    expect(formatRangeLabel(null)).toBe('')
  })

  it('formats paid minutes as hours', () => {
    expect(formatHours(1950)).toBe('32.5 小時')
    expect(formatHours(480)).toBe('8 小時')
  })
})
