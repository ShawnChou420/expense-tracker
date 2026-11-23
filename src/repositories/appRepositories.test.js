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

describe('financialEntryRepository (guest)', () => {
  it('keeps guest entries in memory, notifies readers and is part of the guest snapshot', async () => {
    const { financialEntryRepository, getGuestLedgerSnapshot } =
      await import('./appRepositories.js')
    let updates = 0
    const unsubscribe = subscribeToLedgerChanges(() => {
      updates += 1
    })
    const entry = { id: 'guest-entry-1', date: '2026-11-20', type: 'INCOME', amountMinor: 500 }
    try {
      await financialEntryRepository.save(entry)
      await financialEntryRepository.save({ ...entry, amountMinor: 700 })
      const snapshot = await getGuestLedgerSnapshot()
      expect(snapshot.entries.filter((item) => item.id === entry.id)).toEqual([
        { ...entry, amountMinor: 700 },
      ])
      expect(updates).toBe(2)
    } finally {
      unsubscribe()
      await financialEntryRepository.remove(entry.id)
    }
    expect((await financialEntryRepository.list()).some((item) => item.id === entry.id)).toBe(false)
  })
})
