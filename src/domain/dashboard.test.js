import { describe, expect, it } from 'vitest'
import {
  getActualTransactions,
  getDashboardRange,
  getDashboardSummary,
  getDesignatedWorkProgress,
  getExpenseDistribution,
  getPreferredIncomeMode,
  getSavingProgress,
  validateSavingGoal,
} from './dashboard.js'
import { createExpense } from './expenses.js'

const range = { start: '2026-09-21', end: '2026-09-27' }
const fare = (date, paidAt, status = 'PAID') => ({
  date,
  charges: [{ passengerId: 'a', amountCents: 800, paymentStatus: status, paidAt }],
})
const expense = (date, amountCents, category = 'RENT', group = 'HOUSING', status = 'PAID') =>
  createExpense({ date, amountCents, group, category, status, frequency: 'NONE' })

describe('dashboard period and ledger', () => {
  it('uses Monday-Sunday across year boundaries and calendar months', () => {
    expect(getDashboardRange('2027-01-01', 'week')).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    })
    expect(getDashboardRange('2026-12-31', 'month')).toEqual({
      start: '2026-12-01',
      end: '2026-12-31',
    })
    expect(getDashboardRange('2027-01-01', 'month')).toEqual({
      start: '2027-01-01',
      end: '2027-01-31',
    })
  })

  it('books a fare when received, not when the ride happened; pending stays separate', () => {
    const trips = [fare('2026-09-20', '2026-09-22'), fare('2026-09-23', null, 'PENDING')]
    const summary = getDashboardSummary({ range, trips })
    expect(summary.actualIncomeCents).toBe(800)
    expect(summary.pendingFareCents).toBe(800)
    expect(summary.days.find((day) => day.date === '2026-09-22')?.actualCents).toBe(800)
    expect(summary.days.find((day) => day.date === '2026-09-23')?.actualCents).toBe(0)
  })

  it('accepts an explicitly configured salary deposit source without using gross pay', () => {
    const salaryDeposits = [
      { paidAt: '2026-09-24', amountCents: 102500 },
      { paidAt: '2026-09-24', amountCents: 30000, type: 'TRANSFER' },
    ]
    const summary = getDashboardSummary({ range, salaryDeposits })
    expect(summary.salaryDepositConfigured).toBe(true)
    expect(summary.actualIncomeCents).toBe(102500)
    expect(summary.days.find((day) => day.date === '2026-09-24')?.salaryCents).toBe(102500)
  })

  it('does not count unpaid costs, investment performance, or amortize rent twice', () => {
    const expenses = [
      expense('2026-09-21', 36000),
      expense('2026-09-22', 2000, 'DINING', 'FOOD', 'PLANNED'),
      expense('2026-09-23', 1000, 'INVESTMENT_LOSS', 'FINANCE'),
    ]
    const summary = getDashboardSummary({ range, expenses })
    expect(summary.paidExpenseCents).toBe(36000)
    expect(summary.distribution.totalCents).toBe(36000)
    expect(summary.distribution.detail[0].label).toBe('住房')
  })

  it('counts a recurring rent payment only on its marked paid occurrence', () => {
    const rent = createExpense({
      date: '2026-09-14',
      amountCents: 36000,
      group: 'HOUSING',
      category: 'RENT',
      frequency: 'BIWEEKLY',
      status: 'PLANNED',
      paidDates: ['2026-09-28'],
    })
    expect(getDashboardSummary({ range, expenses: [rent] }).paidExpenseCents).toBe(0)
    expect(
      getDashboardSummary({ range: { start: '2026-09-28', end: '2026-10-04' }, expenses: [rent] })
        .paidExpenseCents,
    ).toBe(36000)
  })

  it('keeps estimated gross pay apart from actual income and reacts to changed records', () => {
    const workRecords = [{ workDate: '2026-09-21', grossPay: 250.15, shiftType: 'normal' }]
    const before = getDashboardSummary({ range, workRecords })
    expect(before.estimatedWorkCents).toBe(25015)
    expect(before.actualIncomeCents).toBe(0)
    expect(before.hasActualIncomeRecords).toBe(false)
    expect(before.salaryDepositConfigured).toBe(false)
    expect(before.days).toHaveLength(7)
    expect(before.days.every((day) => day.actualCents === 0)).toBe(true)
    const after = getDashboardSummary({
      range,
      workRecords: [{ ...workRecords[0], grossPay: 300 }],
    })
    expect(after.days[0].estimatedCents).toBe(30000)
  })

  it('defaults the trend to the mode with data in the selected period', () => {
    const summary = getDashboardSummary({
      range,
      workRecords: [{ workDate: '2026-09-21', grossPay: 200, shiftType: 'normal' }],
      trips: [fare('2026-09-14', '2026-09-15')],
    })
    expect(summary.hasActualIncomeRecords).toBe(true)
    expect(summary.hasActualIncomeInRange).toBe(false)
    expect(getPreferredIncomeMode(summary)).toBe('estimated')
    expect(getPreferredIncomeMode(getDashboardSummary({ range }))).toBeNull()
  })

  it('returns safe empty data and stable top-five expense chart grouping', () => {
    const empty = getDashboardSummary({ range })
    expect(empty.netCents).toBe(0)
    expect(empty.distribution.chart).toEqual([])
    const entries = ['HOUSING', 'FOOD', 'TRANSPORT', 'LIFE', 'INSURANCE', 'FINANCE'].map(
      (group, i) => ({ date: '2026-09-21', group, amountCents: 600 - i * 50 }),
    )
    const distribution = getExpenseDistribution(entries, range)
    expect(distribution.detail).toHaveLength(6)
    expect(distribution.chart).toHaveLength(6)
    expect(distribution.chart.at(-1)?.id).toBe('COMBINED_OTHER')
    expect(distribution.detail[0].color).toBe(
      getExpenseDistribution(entries, range).detail[0].color,
    )
  })
})

describe('saving and designated work', () => {
  const goal = {
    name: '旅費',
    targetCents: 100000,
    initialCents: 30000,
    startDate: '2026-09-01',
    endDate: null,
  }

  it('validates target and dates without rejecting a negative initial balance', () => {
    expect(() => validateSavingGoal({ ...goal, targetCents: 0 })).toThrow()
    expect(() => validateSavingGoal({ ...goal, endDate: '2026-08-31' })).toThrow()
    expect(validateSavingGoal({ ...goal, initialCents: -1000 }).initialCents).toBe(-1000)
  })

  it('starts from the pre-goal balance and only counts actual transactions in its own range', () => {
    const transactions = getActualTransactions({
      trips: [fare('2026-08-31', '2026-09-03'), fare('2026-09-02', '2026-08-31')],
      expenses: [expense('2026-09-05', 45000), expense('2026-10-01', 9000)],
    })
    const result = getSavingProgress(goal, transactions, '2026-09-24')
    expect(result?.currentCents).toBe(-14200)
    expect(result?.progressPercent).toBe(0)
    expect(result?.remainingCents).toBe(114200)
    const over = getSavingProgress(
      { ...goal, initialCents: 120000 },
      { income: [], outgoings: [] },
      '2026-09-24',
    )
    expect(over?.excessCents).toBe(20000)
    expect(over?.progressPercent).toBe(100)
    expect(over?.hasActualTransactions).toBe(false)
  })

  it('counts one marked date even with multiple or overnight shifts', () => {
    const records = [
      {
        workDate: '2026-09-21',
        startTime: '23:00',
        endTime: '06:00',
        paidMinutes: 360,
        shiftType: 'normal',
        designatedWork: true,
      },
      {
        workDate: '2026-09-21',
        startTime: '17:00',
        endTime: '20:00',
        paidMinutes: 180,
        shiftType: 'normal',
        designatedWork: true,
      },
      { workDate: '2026-09-22', paidMinutes: 0, shiftType: 'leave', designatedWork: true },
    ]
    expect(getDesignatedWorkProgress(records)).toMatchObject({
      count: 1,
      remaining: null,
      progressPercent: null,
    })
    expect(getDesignatedWorkProgress(records, 3)).toMatchObject({ count: 1, remaining: 2 })
  })
})
