import { describe, expect, it } from 'vitest'
import {
  addPurchasedUnits,
  completeShoppingItem,
  createShoppingItem,
  getShoppingSections,
  reopenShoppingItem,
  SHOPPING_PRIORITIES,
} from './shopping.js'

const item = (id, overrides = {}) => createShoppingItem({ id, name: id, quantity: 1, ...overrides })

describe('shopping list', () => {
  it('keeps partial purchases on the active list and moves only completed items', () => {
    const half = item('milk', { quantity: 3, purchasedQuantity: 1, priority: 'HIGH' })
    const later = item('chips', { bucket: 'LATER', priority: 'HIGH' })
    const done = item('bread', { purchasedQuantity: 1 })
    const doneLater = item('eggs', { bucket: 'LATER', purchasedQuantity: 1 })
    const sections = getShoppingSections([later, done, half, doneLater])
    expect(sections.now.map((entry) => entry.id)).toEqual(['milk'])
    expect(sections.later.map((entry) => entry.id)).toEqual(['chips'])
    expect(sections.completed.map((entry) => entry.id)).toEqual(['bread', 'eggs'])
    expect(sections.completedNow.map((entry) => entry.id)).toEqual(['bread'])
    expect(sections.completedLater.map((entry) => entry.id)).toEqual(['eggs'])
    expect(sections.urgentCount).toBe(1)
    expect(sections.remainingCount).toBe(2)
  })

  it('sorts urgent items first without changing the stored records', () => {
    const original = [item('normal'), item('urgent', { priority: 'HIGH' })]
    expect(getShoppingSections(original).now.map((entry) => entry.id)).toEqual(['urgent', 'normal'])
    expect(original[0].id).toBe('normal')
  })

  it('rejects invalid quantity and unsupported stores', () => {
    expect(() => item('bad', { quantity: 2, purchasedQuantity: 3 })).toThrow()
    expect(() => item('bad', { quantity: 0 })).toThrow()
    expect(() => item('bad', { store: 'UNKNOWN' })).toThrow()
  })

  it('completes the remainder, reopens one unit, and keeps partial purchases pending', () => {
    const partial = item('milk', { quantity: 3, purchasedQuantity: 1 })
    expect(addPurchasedUnits(partial, 1).purchasedQuantity).toBe(2)
    const completed = completeShoppingItem(partial)
    expect(completed.purchasedQuantity).toBe(3)
    expect(getShoppingSections([completed]).completedNow).toHaveLength(1)
    expect(getShoppingSections([reopenShoppingItem(completed)]).now).toHaveLength(1)
    expect(() => addPurchasedUnits(partial, 3)).toThrow()
  })

  it('renames low priority without changing its stored value', () => {
    expect(SHOPPING_PRIORITIES.find((priority) => priority.id === 'LOW')?.label).toBe('不急')
  })
})
