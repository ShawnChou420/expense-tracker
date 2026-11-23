import { describe, expect, it } from 'vitest'
import {
  classificationOf,
  createFinancialEntry,
  filterFinanceItems,
  financeItemSign,
  getCustomRange,
  groupFinanceItemsByDate,
  getFinanceItems,
  getFinanceSummary,
  getSettledEntryTransactions,
  missingById,
} from './finances.js'
import { createExpense } from './expenses.js'
import { getActualTransactions, getDashboardSummary } from './dashboard.js'
import { getDesignatedWorkProgress } from './dashboard.js'
import { getEstimatedDailyNet } from './dailyNet.js'

const week = { start: '2026-11-16', end: '2026-11-22' }

const entry = (/** @type {any} */ input) =>
  createFinancialEntry({
    id: input.id || `e-${input.date}-${input.category}`,
    type: 'INCOME',
    status: 'SETTLED',
    currency: 'AUD',
    ...input,
  })

const shift = (workDate, grossPay, extra = {}) => ({
  id: `r-${workDate}`,
  workDate,
  startTime: '07:00',
  endTime: '15:30',
  shiftType: 'normal',
  grossPay,
  paidMinutes: 480,
  designatedWork: true,
  ...extra,
})

const deposit = (paidAt, amountCents) => ({ id: `d-${paidAt}`, paidAt, amountCents })

const trip = (date, charges) => ({ id: `t-${date}`, date, type: 'ROUND_TRIP', charges })

describe('createFinancialEntry', () => {
  it('derives the classification from the category', () => {
    expect(classificationOf('INCOME', 'SIDE_JOB')).toBe('NORMAL')
    expect(classificationOf('INCOME', 'INVESTMENT_GAIN')).toBe('INVESTMENT_PNL')
    expect(classificationOf('INCOME', 'REFUND')).toBe('REFUND')
    expect(classificationOf('TRANSFER', 'TRANSFER')).toBe('TRANSFER')
  })

  it('rejects salary, AUD foreign-expense, investment loss and bad amounts', () => {
    expect(() => entry({ date: '2026-11-20', category: 'SALARY', amountMinor: 100 })).toThrow()
    expect(() =>
      entry({ date: '2026-11-20', type: 'EXPENSE', category: 'GROCERIES', amountMinor: 100 }),
    ).toThrow('finances.errors.audExpense')
    expect(() =>
      entry({
        date: '2026-11-20',
        type: 'EXPENSE',
        category: 'INVESTMENT_LOSS',
        currency: 'USD',
        amountMinor: 100,
      }),
    ).toThrow()
    expect(() => entry({ date: '2026-11-20', category: 'BONUS', amountMinor: 0 })).toThrow()
    expect(() => entry({ date: '2026-02-30', category: 'BONUS', amountMinor: 100 })).toThrow()
    expect(() =>
      entry({ date: '2026-11-20', category: 'BONUS', currency: 'JPY', amountMinor: 100 }),
    ).toThrow()
  })
})

describe('P0 1：一般收入只進已確認收入，不影響薪資、集簽、工時', () => {
  it('second-hand sale adds to confirmed income only', () => {
    const workRecords = [shift('2026-11-17', 250)]
    const before = getFinanceSummary({ range: week, workRecords })
    const sale = entry({ date: '2026-11-18', category: 'SECONDHAND_SALE', amountMinor: 8000 })
    const after = getFinanceSummary({ range: week, workRecords, entries: [sale] })
    expect(after.confirmedIncomeCents).toBe(8000)
    expect(after.otherIncomeCents).toBe(8000)
    expect(after.salaryIncomeCents).toBe(0)
    expect(after.estimatedPayCents).toBe(before.estimatedPayCents)
    expect(after.estimatedPayCents).toBe(25000)
    // 集簽／指定工作日只看班表，與收支資料無關
    expect(getDesignatedWorkProgress(workRecords, 88).count).toBe(1)
  })

  it('home dashboard actual income includes settled income; without entries nothing changes', () => {
    const base = {
      range: week,
      trips: [],
      expenses: [],
      salaryDeposits: [deposit('2026-11-20', 90000)],
    }
    const legacy = getDashboardSummary(base)
    expect(legacy.actualIncomeCents).toBe(90000)
    expect(getDashboardSummary({ ...base, entries: [] })).toEqual(legacy)
    const withIncome = getDashboardSummary({
      ...base,
      entries: [entry({ date: '2026-11-19', category: 'BONUS', amountMinor: 5000 })],
    })
    expect(withIncome.actualIncomeCents).toBe(95000)
    expect(withIncome.estimatedWorkCents).toBe(legacy.estimatedWorkCents)
    expect(withIncome.days.find((day) => day.date === '2026-11-19')?.otherCents).toBe(5000)
  })
})

describe('P0 2：多幣別，無匯率不得併入 AUD 合計', () => {
  it('TWD without a rate is listed as unconverted, not summed', () => {
    const twd = entry({
      date: '2026-11-18',
      category: 'SECONDHAND_SALE',
      currency: 'TWD',
      amountMinor: 150000,
    })
    expect(twd.convertedAudCents).toBeNull()
    const summary = getFinanceSummary({ range: week, entries: [twd] })
    expect(summary.confirmedIncomeCents).toBe(0)
    expect(summary.unconverted).toEqual([{ currency: 'TWD', amountMinor: 150000, count: 1 }])
    expect(getSettledEntryTransactions([twd]).income).toEqual([])
    const day = getEstimatedDailyNet({ range: week, entries: [twd] }).get('2026-11-18')
    expect(day?.netCents).toBe(0)
    expect(day?.unconvertedItems).toHaveLength(1)
  })

  it('with a rate, the converted AUD cents are used and the original is kept', () => {
    const usd = entry({
      date: '2026-11-18',
      type: 'EXPENSE',
      category: 'TRAVEL',
      currency: 'USD',
      amountMinor: 10000,
      fxRate: '1.53',
      fxRateDate: '2026-11-18',
      fxSource: 'OPEN_ER_API',
    })
    expect(usd.convertedAudCents).toBe(15300)
    expect(usd.fxSource).toBe('OPEN_ER_API')
    const summary = getFinanceSummary({ range: week, entries: [usd] })
    expect(summary.paidExpenseCents).toBe(15300)
    expect(summary.netCents).toBe(-15300)
    const [item] = getFinanceItems({ range: week, entries: [usd] })
    expect(item.original).toEqual({ amountMinor: 10000, currency: 'USD' })
    expect(item.audCents).toBe(15300)
  })
})

describe('P0 3：車資應收依行程日、實收依收款日，不重複', () => {
  it('a ride in this week paid next week: receivable now, income next week, never both', () => {
    const trips = [
      trip('2026-11-20', [
        {
          passengerId: 'p1',
          amountCents: 3000,
          payments: [
            { paidAt: '2026-11-21', amountCents: 1000 },
            { paidAt: '2026-11-25', amountCents: 2000 },
          ],
        },
      ]),
    ]
    const thisWeek = getFinanceSummary({ range: week, trips })
    expect(thisWeek.fareIncomeCents).toBe(1000)
    expect(thisWeek.receivable.fareCents).toBe(0) // 全部已收（雖然部分在下週）
    const nextWeek = getFinanceSummary({ range: { start: '2026-11-23', end: '2026-11-29' }, trips })
    expect(nextWeek.fareIncomeCents).toBe(2000)
    expect(nextWeek.receivable.fareCents).toBe(0)

    const unpaid = [trip('2026-11-20', [{ passengerId: 'p1', amountCents: 3000, payments: [] }])]
    const pending = getFinanceSummary({ range: week, trips: unpaid })
    expect(pending.receivable.fareCents).toBe(3000)
    expect(pending.confirmedIncomeCents).toBe(0)
    const items = getFinanceItems({ range: week, trips: unpaid })
    expect(items).toHaveLength(1)
    expect(items[0].status).toBe('UNPAID')
  })
})

describe('P0 4：薪資預估與 Payslip 入帳不重複加總', () => {
  it('estimated pay and deposits are separate numbers', () => {
    const summary = getFinanceSummary({
      range: week,
      workRecords: [shift('2026-11-17', 250), shift('2026-11-18', 250)],
      salaryDeposits: [deposit('2026-11-20', 42000)],
    })
    expect(summary.estimatedPayCents).toBe(50000)
    expect(summary.salaryIncomeCents).toBe(42000)
    expect(summary.confirmedIncomeCents).toBe(42000)
    const items = getFinanceItems({
      range: week,
      workRecords: [shift('2026-11-17', 250)],
      salaryDeposits: [deposit('2026-11-20', 42000)],
    })
    expect(items.map((item) => item.basis).sort()).toEqual(['ACTUAL', 'ESTIMATED'])
  })
})

describe('P0 5：投資獲利與既有 INVESTMENT_LOSS 口徑一致', () => {
  const loss = createExpense({
    date: '2026-11-17',
    amountCents: 3000,
    group: 'FINANCE',
    category: 'INVESTMENT_LOSS',
    status: 'PAID',
    frequency: 'NONE',
  })
  const gain = entry({ date: '2026-11-18', category: 'INVESTMENT_GAIN', amountMinor: 5000 })

  it('neither counts as normal income or expense; shown as investment performance', () => {
    const summary = getFinanceSummary({ range: week, expenses: [loss], entries: [gain] })
    expect(summary.confirmedIncomeCents).toBe(0)
    expect(summary.paidExpenseCents).toBe(0)
    expect(summary.investment).toEqual({ gainCents: 5000, lossCents: 3000, netCents: 2000 })
    const actual = getActualTransactions({ expenses: [loss], entries: [gain] })
    expect(actual).toEqual({ income: [], outgoings: [] })
  })

  it('calendar daily net: loss unchanged (regression), gain added on the same basis', () => {
    const days = getEstimatedDailyNet({ range: week, expenses: [loss], entries: [gain] })
    expect(days.get('2026-11-17')?.investmentLossCents).toBe(3000)
    expect(days.get('2026-11-17')?.netCents).toBe(-3000)
    expect(days.get('2026-11-18')?.investmentGainCents).toBe(5000)
    expect(days.get('2026-11-18')?.netCents).toBe(5000)
    expect(days.get('2026-11-18')?.incomeCents).toBe(0)
  })

  it('a planned (unrealized) gain is not counted', () => {
    const planned = entry({ ...gain, id: 'g2', status: 'PLANNED' })
    expect(getFinanceSummary({ range: week, entries: [planned] }).investment.gainCents).toBe(0)
    expect(getEstimatedDailyNet({ range: week, entries: [planned] }).size).toBe(0)
  })
})

describe('P0 6：資金移轉不算收入或支出', () => {
  it('transfer is excluded from every total', () => {
    const transfer = entry({
      date: '2026-11-19',
      type: 'TRANSFER',
      category: 'TRANSFER',
      currency: 'TWD',
      amountMinor: 3000000,
      fxRate: '0.048',
    })
    expect(transfer.classification).toBe('TRANSFER')
    const summary = getFinanceSummary({ range: week, entries: [transfer] })
    expect(summary.confirmedIncomeCents).toBe(0)
    expect(summary.paidExpenseCents).toBe(0)
    expect(summary.netCents).toBe(0)
    expect(summary.transferCount).toBe(1)
    expect(summary.unconverted).toEqual([])
    expect(getActualTransactions({ entries: [transfer] })).toEqual({ income: [], outgoings: [] })
    expect(getEstimatedDailyNet({ range: week, entries: [transfer] }).size).toBe(0)
  })

  it('refunds are listed apart, not income and not net', () => {
    const refund = entry({ date: '2026-11-19', category: 'REFUND', amountMinor: 2500 })
    const summary = getFinanceSummary({ range: week, entries: [refund] })
    expect(summary.refundCents).toBe(2500)
    expect(summary.confirmedIncomeCents).toBe(0)
    expect(summary.netCents).toBe(0)
  })

  it('planned income is a receivable, not confirmed income', () => {
    const bonus = entry({
      date: '2026-11-21',
      category: 'BONUS',
      status: 'PLANNED',
      amountMinor: 10000,
    })
    const summary = getFinanceSummary({ range: week, entries: [bonus] })
    expect(summary.confirmedIncomeCents).toBe(0)
    expect(summary.receivable.plannedIncomeCents).toBe(10000)
    expect(getActualTransactions({ entries: [bonus] }).income).toEqual([])
  })
})

describe('P0 7：訪客資料登入合併不重複', () => {
  it('only entries the member does not have are sent, and a re-run sends nothing', () => {
    const a = entry({ id: 'guest-a', date: '2026-11-18', category: 'GIFT', amountMinor: 100 })
    const b = entry({ id: 'guest-b', date: '2026-11-18', category: 'GIFT', amountMinor: 200 })
    expect(missingById([a, b], [{ id: 'guest-a' }])).toEqual([b])
    expect(missingById([a, b], [a, b])).toEqual([])
  })
})

describe('getFinanceItems', () => {
  it('each source appears once with sourceType and sourceId, newest first', () => {
    const recurring = createExpense({
      date: '2026-11-16',
      amountCents: 20000,
      group: 'HOUSING',
      category: 'RENT',
      status: 'PLANNED',
      frequency: 'WEEKLY',
      paidDates: ['2026-11-16'],
    })
    const items = getFinanceItems({
      range: { start: '2026-11-16', end: '2026-11-29' },
      expenses: [recurring],
      entries: [entry({ date: '2026-11-18', category: 'GIFT', amountMinor: 100 })],
    })
    expect(items.map((item) => [item.sourceType, item.date, item.basis])).toEqual([
      ['EXPENSE', '2026-11-23', 'PLANNED'],
      ['FINANCIAL_ENTRY', '2026-11-18', 'ACTUAL'],
      ['EXPENSE', '2026-11-16', 'ACTUAL'],
    ])
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length)
  })
})

describe('finances page helpers', () => {
  const items = getFinanceItems({
    range: week,
    workRecords: [shift('2026-11-17', 250)],
    salaryDeposits: [deposit('2026-11-20', 42000)],
    trips: [trip('2026-11-18', [{ passengerId: 'p1', amountCents: 3000, payments: [] }])],
    expenses: [
      createExpense({
        date: '2026-11-19',
        amountCents: 1000,
        group: 'FINANCE',
        category: 'INVESTMENT_LOSS',
        status: 'PAID',
        frequency: 'NONE',
      }),
    ],
    entries: [
      entry({ id: 'gain', date: '2026-11-19', category: 'INVESTMENT_GAIN', amountMinor: 500 }),
      entry({
        id: 'tw',
        date: '2026-11-21',
        type: 'TRANSFER',
        category: 'TRANSFER',
        currency: 'TWD',
        amountMinor: 100000,
      }),
    ],
  })

  it('filters by kind and never lists estimated pay', () => {
    const ids = (filter) =>
      filterFinanceItems(items, filter).map((item) => item.sourceType + ':' + item.kind)
    expect(ids('ALL')).not.toContain('WORK_ESTIMATE:INCOME')
    expect(ids('ALL')).toHaveLength(5)
    expect(ids('INCOME').sort()).toEqual(['FINANCIAL_ENTRY:INVESTMENT', 'SALARY_DEPOSIT:INCOME'])
    expect(ids('EXPENSE')).toEqual(['EXPENSE:INVESTMENT'])
    expect(ids('FARE')).toEqual(['TRIP_CHARGE:FARE'])
  })

  it('signs: gain +, loss −, transfer 0', () => {
    const bySource = Object.fromEntries(items.map((item) => [item.key, financeItemSign(item)]))
    expect(bySource['FINANCIAL_ENTRY:gain']).toBe(1)
    expect(bySource['FINANCIAL_ENTRY:tw']).toBe(0)
    expect(Object.entries(bySource).find(([key]) => key.startsWith('EXPENSE:'))?.[1]).toBe(-1)
  })

  it('groups by date, newest first', () => {
    expect(groupFinanceItemsByDate(filterFinanceItems(items)).map((group) => group.date)).toEqual([
      '2026-11-21',
      '2026-11-20',
      '2026-11-19',
      '2026-11-18',
    ])
  })

  it('validates custom ranges', () => {
    expect(getCustomRange('2026-11-01', '2026-11-30')).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    })
    expect(getCustomRange('2026-11-30', '2026-11-01')).toBeNull()
    expect(getCustomRange('2025-01-01', '2026-11-30')).toBeNull()
    expect(getCustomRange('', '2026-11-30')).toBeNull()
  })
})
