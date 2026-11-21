import { describe, expect, it } from 'vitest'
import { formatDailyNet, getEstimatedDailyNet, hasDailyNetActivity } from './dailyNet.js'
import { createExpense } from './expenses.js'

const range = { start: '2026-11-01', end: '2026-11-30' }
const shift = (workDate, grossPay, extra = {}) => ({
  id: `r-${workDate}`,
  workDate,
  startTime: '07:00',
  endTime: '15:30',
  shiftType: 'normal',
  grossPay,
  ...extra,
})
/** 取出某天（測試中一定存在） */
const dayIn = (/** @type {Map<string, any>} */ days, /** @type {string} */ date) => {
  const day = days.get(date)
  if (!day) throw new Error(`missing ${date}`)
  return day
}
const expense = (input) =>
  createExpense({
    group: 'FOOD',
    category: 'GROCERIES',
    status: 'PAID',
    frequency: 'NONE',
    ...input,
  })

describe('getEstimatedDailyNet', () => {
  it('work income plus paid groceries → +155 (acceptance 1)', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [shift('2026-11-10', 203)],
      expenses: [expense({ date: '2026-11-10', amountCents: 4800 })],
    })
    const day = dayIn(days, '2026-11-10')
    expect(day.workCents).toBe(20300)
    expect(day.expenseCents).toBe(4800)
    expect(day.netCents).toBe(15500)
    expect(formatDailyNet(day.netCents).text).toBe('+155')
  })

  it('leave day with paid accommodation → −120 (acceptance 2)', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [{ ...shift('2026-11-11', 0), shiftType: 'leave', leaveType: 'HOLIDAY' }],
      expenses: [
        expense({
          date: '2026-11-11',
          amountCents: 12000,
          group: 'HOUSING',
          category: 'RENT',
        }),
      ],
    })
    const day = dayIn(days, '2026-11-11')
    expect(day.workItems).toEqual([])
    expect(day.netCents).toBe(-12000)
    expect(formatDailyNet(day.netCents)).toEqual({
      text: '−120',
      sign: 'negative',
    })
  })

  it('days without records are absent, not zero (acceptance 3)', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [shift('2026-11-10', 203)],
    })
    expect(days.has('2026-11-12')).toBe(false)
    expect(hasDailyNetActivity(days.get('2026-11-12'))).toBe(false)
    expect(hasDailyNetActivity(days.get('2026-11-10'))).toBe(true)
  })

  it('counts a fare once on the ride date, whether pending, partly or fully received (acceptance 4)', () => {
    const trips = [
      {
        id: 't1',
        date: '2026-11-10',
        type: 'TO_WORK',
        charges: [
          {
            passengerId: 'a',
            amountCents: 800,
            paymentStatus: 'PAID',
            paidAt: '2026-11-14',
          },
          { passengerId: 'b', amountCents: 800, paymentStatus: 'PENDING' },
          {
            passengerId: 'c',
            amountCents: 800,
            payments: [{ paidAt: '2026-11-12', amountCents: 300 }],
          },
        ],
      },
    ]
    const days = getEstimatedDailyNet({
      range,
      trips,
      passengerNames: { a: 'Amy' },
    })
    expect(dayIn(days, '2026-11-10').fareCents).toBe(2400)
    expect(dayIn(days, '2026-11-10').fareItems.map((item) => item.receivedCents)).toEqual([
      800, 0, 300,
    ])
    expect(dayIn(days, '2026-11-10').fareItems[0].passengerName).toBe('Amy')
    // 收款日不會再加一次
    expect(days.has('2026-11-14')).toBe(false)
    expect(days.has('2026-11-12')).toBe(false)
  })

  it('salary deposits are listed but never added to the estimate (acceptance 5)', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [shift('2026-11-10', 203)],
      salaryDeposits: [
        { id: 's1', paidAt: '2026-11-10', amountCents: 90000, type: 'SALARY' },
        { id: 's2', paidAt: '2026-11-17', amountCents: 90000, type: 'SALARY' },
        { id: 's3', paidAt: '2026-11-17', amountCents: 5000, type: 'TRANSFER' },
      ],
    })
    expect(dayIn(days, '2026-11-10').netCents).toBe(20300)
    expect(dayIn(days, '2026-11-10').salaryDeposits).toHaveLength(1)
    expect(dayIn(days, '2026-11-17').netCents).toBe(0)
    expect(dayIn(days, '2026-11-17').salaryDeposits).toEqual([{ id: 's2', amountCents: 90000 }])
    expect(hasDailyNetActivity(days.get('2026-11-17'))).toBe(false)
  })

  it('books an overnight shift on the day it starts (acceptance 8)', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [shift('2026-11-13', 260, { startTime: '22:00', endTime: '06:30' })],
    })
    expect(dayIn(days, '2026-11-13').workCents).toBe(26000)
    expect(days.has('2026-11-14')).toBe(false)
  })

  it('recurring expenses: each due date once, paid or planned; payment date does not add another', () => {
    const rent = createExpense({
      date: '2026-11-02',
      amountCents: 25000,
      group: 'HOUSING',
      category: 'RENT',
      frequency: 'WEEKLY',
      status: 'PLANNED',
      paidDates: ['2026-11-02'],
    })
    // 會員資料：付款紀錄的 paidAt 與到期日不同
    rent.payments = [
      {
        occurrenceDate: '2026-11-02',
        paidAt: '2026-11-04',
        amountCents: 25000,
      },
    ]
    const days = getEstimatedDailyNet({ range, expenses: [rent] })
    expect(dayIn(days, '2026-11-02').expenseItems[0].status).toBe('PAID')
    expect(dayIn(days, '2026-11-09').expenseItems[0].status).toBe('PLANNED')
    expect(dayIn(days, '2026-11-09').plannedExpenseCents).toBe(25000)
    expect(days.has('2026-11-04')).toBe(false)
    expect([...days.keys()]).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ])
  })

  it('deducts realized investment loss from the net, listed apart from living expenses', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [shift('2026-11-18', 203)],
      expenses: [
        expense({
          date: '2026-11-18',
          amountCents: 100000,
          group: 'FINANCE',
          category: 'INVESTMENT_LOSS',
        }),
        expense({ date: '2026-11-18', amountCents: 4800 }),
        expense({
          date: '2026-11-19',
          amountCents: 5000,
          group: 'FINANCE',
          category: 'INVESTMENT_LOSS',
        }),
      ],
    })
    const day = dayIn(days, '2026-11-18')
    expect(day.expenseCents).toBe(4800)
    expect(day.investmentLossCents).toBe(100000)
    expect(day.investmentLossItems).toHaveLength(1)
    expect(day.expenseItems).toHaveLength(1)
    expect(day.netCents).toBe(20300 - 4800 - 100000)
    expect(formatDailyNet(day.netCents).text).toBe('−845')
    // 只有投資虧損的日子也算有資料
    expect(hasDailyNetActivity(dayIn(days, '2026-11-19'))).toBe(true)
    expect(dayIn(days, '2026-11-19').netCents).toBe(-5000)
  })

  it('ignores records outside the range', () => {
    const days = getEstimatedDailyNet({
      range,
      workRecords: [shift('2026-10-31', 200)],
      expenses: [expense({ date: '2026-12-01', amountCents: 5000 })],
    })
    expect(days.size).toBe(0)
  })

  it('returns an empty map for an invalid range', () => {
    expect(
      getEstimatedDailyNet({
        range: null,
        workRecords: [shift('2026-11-10', 1)],
      }).size,
    ).toBe(0)
  })
})

describe('formatDailyNet', () => {
  it('always shows a sign and converts with the display rate', () => {
    expect(formatDailyNet(15500)).toEqual({ text: '+155', sign: 'positive' })
    expect(formatDailyNet(-4800)).toEqual({ text: '−48', sign: 'negative' })
    expect(formatDailyNet(0)).toEqual({ text: '0', sign: 'zero' })
    expect(formatDailyNet(30)).toEqual({ text: '0', sign: 'zero' })
    expect(formatDailyNet(15500, 21.2)).toEqual({
      text: '+3286',
      sign: 'positive',
    })
    expect(formatDailyNet(-123456, 21)).toEqual({
      text: '−25.9K',
      sign: 'negative',
    })
    // 韓元等大額幣別：十萬以上不顯示小數，避免日曆格被截斷
    expect(formatDailyNet(15500, 900)).toEqual({ text: '+140K', sign: 'positive' })
    expect(formatDailyNet(-123450, 900)).toEqual({ text: '−1M', sign: 'negative' })
  })
})
