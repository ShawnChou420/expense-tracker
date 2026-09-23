import { describe, expect, it } from 'vitest'
import { createExpense, getExpenseOccurrences, getExpenseSummary } from '../src/domain/expenses.js'
import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.js'

const base = {
  date: '2026-09-23',
  group: 'FOOD',
  category: 'GROCERIES',
  amountCents: 1299,
  status: 'PAID',
}
const week = { start: '2026-09-21', end: '2026-09-27' }

describe('expense records', () => {
  it('keeps amounts in cents and updates summaries after edits', () => {
    const paid = createExpense(base)
    const planned = createExpense({
      ...base,
      group: 'TRANSPORT',
      category: 'FUEL',
      amountCents: 3000,
      status: 'PLANNED',
    })
    expect(getExpenseSummary([paid, planned], week)).toMatchObject({
      paidCents: 1299,
      plannedCents: 3000,
      count: 2,
    })
    expect(
      getExpenseSummary([createExpense({ ...paid, amountCents: 1500 }), planned], week).paidCents,
    ).toBe(1500)
  })

  it('excludes other weeks and handles empty data', () => {
    expect(getExpenseSummary([], week)).toMatchObject({
      paidCents: 0,
      plannedCents: 0,
      count: 0,
      byGroup: [],
    })
    expect(getExpenseSummary([createExpense({ ...base, date: '2026-09-28' })], week).count).toBe(0)
  })

  it('rejects invalid dates, amounts and categories', () => {
    expect(() => createExpense({ ...base, date: '2026-02-30' })).toThrow()
    expect(() => createExpense({ ...base, amountCents: 0 })).toThrow()
    expect(() => createExpense({ ...base, category: 'UNKNOWN' })).toThrow()
    expect(() => createExpense({ ...base, group: 'HOUSING' })).toThrow()
    expect(() => createExpense({ ...base, frequency: 'CUSTOM', intervalDays: 0 })).toThrow()
    expect(() =>
      createExpense({
        ...base,
        group: 'FINANCE',
        category: 'INVESTMENT_LOSS',
        frequency: 'WEEKLY',
      }),
    ).toThrow()
  })

  it('projects weekly and biweekly bills as planned until each occurrence is marked paid', () => {
    const gym = createExpense({
      ...base,
      group: 'LIFE',
      category: 'FITNESS',
      frequency: 'WEEKLY',
      status: 'PLANNED',
    })
    const rent = createExpense({
      ...base,
      group: 'HOUSING',
      category: 'RENT',
      amountCents: 36000,
      frequency: 'BIWEEKLY',
      paidDates: ['2026-09-23'],
    })
    expect(getExpenseSummary([gym, rent], week)).toMatchObject({
      paidCents: 36000,
      plannedCents: 1299,
    })
    expect(
      getExpenseSummary([gym, rent], { start: '2026-09-28', end: '2026-10-04' }),
    ).toMatchObject({ paidCents: 0, plannedCents: 1299 })
    expect(
      getExpenseSummary([gym, rent], { start: '2026-10-05', end: '2026-10-11' }),
    ).toMatchObject({ paidCents: 0, plannedCents: 37299 })
  })

  it('clamps a monthly bill to the last day of shorter months', () => {
    const bill = createExpense({
      ...base,
      date: '2026-01-31',
      frequency: 'MONTHLY',
      status: 'PLANNED',
    })
    expect(
      getExpenseOccurrences([bill], { start: '2026-02-23', end: '2026-03-01' }).map(
        (item) => item.date,
      ),
    ).toEqual(['2026-02-28'])
    expect(
      getExpenseOccurrences([bill], { start: '2026-03-30', end: '2026-04-05' }).map(
        (item) => item.date,
      ),
    ).toEqual(['2026-03-31'])
  })

  it('ends a recurring bill without erasing its earlier paid occurrence', () => {
    const rent = createExpense({
      ...base,
      group: 'HOUSING',
      category: 'RENT',
      frequency: 'BIWEEKLY',
      paidDates: ['2026-09-23'],
      endDate: '2026-09-30',
    })
    expect(getExpenseSummary([rent], week).paidCents).toBe(1299)
    expect(getExpenseSummary([rent], { start: '2026-10-05', end: '2026-10-11' }).count).toBe(0)
    expect(() => createExpense({ ...rent, endDate: '2026-09-22' })).toThrow()
  })

  it('separates investment loss from cash expenses', () => {
    const loss = createExpense({
      ...base,
      group: 'FINANCE',
      category: 'INVESTMENT_LOSS',
      amountCents: 5000,
    })
    expect(getExpenseSummary([loss], week)).toMatchObject({
      paidCents: 0,
      investmentLossCents: 5000,
      byGroup: [],
    })
  })

  it('supports save, update and delete in temporary storage', async () => {
    const repository = createInMemoryExpenseRepository()
    const record = createExpense(base)
    await repository.save(record)
    expect(await repository.list()).toHaveLength(1)
    await repository.save(createExpense({ ...record, amountCents: 2000 }))
    expect((await repository.list())[0].amountCents).toBe(2000)
    await repository.remove(record.id)
    expect(await repository.list()).toEqual([])
  })
})
