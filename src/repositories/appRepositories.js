import { createInMemoryExpenseRepository } from './inMemoryExpenseRepository.js'
import {
  createInMemoryPassengerRepository,
  createInMemoryTripRepository,
} from './inMemoryTripRepositories.js'

const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())

export function subscribeToLedgerChanges(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const passengers = createInMemoryPassengerRepository()
const trips = createInMemoryTripRepository()
const expenses = createInMemoryExpenseRepository()

// These adapters remain in memory only; the wrapper shares their single instance across pages.
export const passengerRepository = {
  list: () => passengers.list(),
  async save(passenger) {
    const saved = await passengers.save(passenger)
    notify()
    return saved
  },
}

export const tripRepository = {
  list: () => trips.list(),
  listByDateRange: (start, end) => trips.listByDateRange(start, end),
  async save(trip) {
    const saved = await trips.save(trip)
    notify()
    return saved
  },
  async remove(id) {
    await trips.remove(id)
    notify()
  },
}

export const expenseRepository = {
  list: () => expenses.list(),
  async save(expense) {
    const saved = await expenses.save(expense)
    notify()
    return saved
  },
  async remove(id) {
    await expenses.remove(id)
    notify()
  },
}
