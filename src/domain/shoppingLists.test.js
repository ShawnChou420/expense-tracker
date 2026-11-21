import { describe, expect, it } from 'vitest'
import {
  addShoppingItem,
  buildShoppingExpense,
  estimateShoppingTotals,
  shoppingExpenseId,
  splitForCompletion,
} from './shoppingLists.js'
import { createShoppingItem } from './shopping.js'

const item = (id, overrides = {}) => createShoppingItem({ id, name: id, quantity: 1, ...overrides })

describe('shopping list totals', () => {
  it('multiplies quantity by unit price and counts unpriced items separately', () => {
    const totals = estimateShoppingTotals([
      item('tim', { quantity: 2, estimatedUnitPriceCents: 250 }),
      item('bread', {
        quantity: 3,
        estimatedUnitPriceCents: 350,
        purchasedQuantity: 1,
      }),
      item('milk'),
      item('later', { bucket: 'LATER', estimatedUnitPriceCents: 9999 }),
    ])
    expect(totals.estimatedCents).toBe(2 * 250 + 3 * 350)
    expect(totals.unpricedCount).toBe(1)
    expect(totals.purchasedCents).toBe(350)
    expect(totals.purchasedCount).toBe(1)
  })

  it('uses the actual unit price for purchased units when given', () => {
    const totals = estimateShoppingTotals([
      item('bread', {
        quantity: 2,
        purchasedQuantity: 2,
        estimatedUnitPriceCents: 350,
        actualUnitPriceCents: 300,
      }),
      item('milk', { purchasedQuantity: 1 }),
    ])
    expect(totals.estimatedCents).toBe(700)
    expect(totals.purchasedCents).toBe(600)
    expect(totals.purchasedUnpricedCount).toBe(1)
  })

  it('can total the "later" bucket on its own', () => {
    const totals = estimateShoppingTotals(
      [
        item('a', { estimatedUnitPriceCents: 100 }),
        item('b', { bucket: 'LATER', estimatedUnitPriceCents: 40 }),
      ],
      { bucket: 'LATER' },
    )
    expect(totals.estimatedCents).toBe(40)
  })

  it('rejects negative or fractional prices', () => {
    expect(() => item('x', { estimatedUnitPriceCents: -1 })).toThrow()
    expect(() => item('x', { estimatedUnitPriceCents: 1.5 })).toThrow()
  })
})

describe('adding items', () => {
  const special = (id, promotionId, extra = {}) =>
    item(id, { promotionId, estimatedUnitPriceCents: 250, ...extra })

  it('merges the same special into one row instead of duplicating', () => {
    const first = addShoppingItem([], special('a', 9))
    const second = addShoppingItem(first.items, special('b', 9))
    expect(second.items).toHaveLength(1)
    expect(second.item).toMatchObject({ id: 'a', quantity: 2 })
    expect(second.merged).toBe(true)
  })

  it('keeps different sizes (different promotions) as separate rows', () => {
    const first = addShoppingItem([], special('a', 9, { packageSize: '375ml' }))
    const second = addShoppingItem(first.items, special('b', 10, { packageSize: '1.25L' }))
    expect(second.items).toHaveLength(2)
  })

  it('ignores a double tap that resends the same id', () => {
    const first = addShoppingItem([], special('a', 9))
    const again = addShoppingItem(first.items, special('a', 9))
    expect(again.items).toHaveLength(1)
    expect(again.item.quantity).toBe(1)
  })

  it('adds manual items without a price', () => {
    const result = addShoppingItem([], item('milk'))
    expect(result.item).toMatchObject({
      promotionId: null,
      estimatedUnitPriceCents: null,
    })
  })

  it('caps merged quantity at 999', () => {
    const first = addShoppingItem([], special('a', 9, { quantity: 999 }))
    expect(addShoppingItem(first.items, special('b', 9)).item.quantity).toBe(999)
  })
})

describe('completing a shopping trip', () => {
  it('keeps purchased units and carries the rest to the next list', () => {
    let next = 0
    const { purchased, carryOver } = splitForCompletion(
      [
        item('tim', { quantity: 2, purchasedQuantity: 2 }),
        item('bread', {
          quantity: 3,
          purchasedQuantity: 1,
          actualUnitPriceCents: 300,
        }),
        item('milk', { quantity: 2 }),
      ],
      () => `new-${++next}`,
    )
    expect(purchased.map((entry) => [entry.id, entry.quantity])).toEqual([
      ['tim', 2],
      ['bread', 1],
    ])
    expect(carryOver.map((entry) => [entry.id, entry.quantity, entry.purchasedQuantity])).toEqual([
      ['new-1', 2, 0],
      ['milk', 2, 0],
    ])
    expect(carryOver[0].actualUnitPriceCents).toBeNull()
  })

  it('builds one paid grocery expense with a fixed id so resubmits update the same record', () => {
    const expense = buildShoppingExpense({
      listId: 'list-a',
      date: '2026-11-21',
      amountCents: 2350,
      itemCount: 3,
    })
    expect(expense).toMatchObject({
      id: shoppingExpenseId('list-a'),
      group: 'FOOD',
      category: 'GROCERIES',
      status: 'PAID',
      frequency: 'NONE',
      amountCents: 2350,
    })
    expect(expense.id).toBe('shopping-list-list-a')
    expect(() =>
      buildShoppingExpense({
        listId: 'x',
        date: '2026-11-21',
        amountCents: 0,
        itemCount: 1,
      }),
    ).toThrow()
  })
})
