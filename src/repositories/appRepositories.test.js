import { describe, expect, it } from 'vitest'
import { expenseRepository, subscribeToLedgerChanges, tripRepository } from './appRepositories.js'

describe('shared in-memory ledger repositories', () => {
  it('notifies dashboard readers after writes and removals', async () => {
    let updates = 0
    const unsubscribe = subscribeToLedgerChanges(() => {
      updates += 1
    })
    const trip = { id: 'dashboard-test-trip', date: '2026-09-21', charges: [] }
    const expense = { id: 'dashboard-test-expense', date: '2026-09-21', amountCents: 1200 }
    try {
      await tripRepository.save(trip)
      await expenseRepository.save(expense)
      expect(updates).toBe(2)
      expect((await tripRepository.list()).some((item) => item.id === trip.id)).toBe(true)
      expect((await expenseRepository.list()).some((item) => item.id === expense.id)).toBe(true)
    } finally {
      unsubscribe()
      await tripRepository.remove(trip.id)
      await expenseRepository.remove(expense.id)
    }
    expect(updates).toBe(2)
  })
})
