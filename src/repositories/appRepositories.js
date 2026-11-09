import { createInMemoryExpenseRepository } from './inMemoryExpenseRepository.js'
import {
  createInMemoryPassengerRepository,
  createInMemoryTripRepository,
} from './inMemoryTripRepositories.js'
import { watch } from 'vue'
import { apiRequest, authToken } from '../services/authSession.js'

const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())
export const notifyLedgerChanged = notify
watch(authToken, notify)

export function subscribeToLedgerChanges(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const passengers = createInMemoryPassengerRepository()
const trips = createInMemoryTripRepository()
const expenses = createInMemoryExpenseRepository()

// These adapters remain in memory only; the wrapper shares their single instance across pages.
export const passengerRepository = {
  list: () => (authToken.value ? apiRequest('/passengers') : passengers.list()),
  async save(passenger) {
    const saved = authToken.value
      ? await apiRequest(`/passengers/${encodeURIComponent(passenger.id)}`, {
          method: 'PUT',
          body: passenger,
        })
      : await passengers.save(passenger)
    notify()
    return saved
  },
}

export const tripRepository = {
  list: () => (authToken.value ? apiRequest('/trips') : trips.list()),
  async listByDateRange(start, end) {
    const all = await this.list()
    return all.filter((trip) => trip.date >= start && trip.date <= end)
  },
  async save(trip) {
    const saved = authToken.value
      ? await apiRequest(`/trips/${encodeURIComponent(trip.id)}`, { method: 'PUT', body: trip })
      : await trips.save(trip)
    notify()
    return saved
  },
  async remove(id) {
    if (authToken.value) await apiRequest(`/trips/${encodeURIComponent(id)}`, { method: 'DELETE' })
    else await trips.remove(id)
    notify()
  },
  async addPayment(tripId, passengerId, payment) {
    if (!authToken.value) throw new Error('部分收款需登入後保存')
    const result = await apiRequest(
      `/trips/${encodeURIComponent(tripId)}/charges/${encodeURIComponent(passengerId)}/payments`,
      { method: 'POST', body: payment },
    )
    notify()
    return result
  },
}

export const expenseRepository = {
  list: () => (authToken.value ? apiRequest('/expenses') : expenses.list()),
  async save(expense) {
    const saved = authToken.value
      ? await apiRequest(`/expenses/${encodeURIComponent(expense.id)}`, {
          method: 'PUT',
          body: expense,
        })
      : await expenses.save(expense)
    notify()
    return saved
  },
  async remove(id) {
    if (authToken.value)
      await apiRequest(`/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' })
    else await expenses.remove(id)
    notify()
  },
  async recordPayment(id, payment) {
    if (!authToken.value) throw new Error('請先登入再記錄實際付款日期')
    const saved = await apiRequest(`/expenses/${encodeURIComponent(id)}/payments`, {
      method: 'POST',
      body: payment,
    })
    notify()
    return saved
  },
}

export const salaryDepositRepository = {
  list: () => (authToken.value ? apiRequest('/salary-deposits') : Promise.resolve(null)),
  async save(deposit) {
    if (!authToken.value) throw new Error('請先登入再記錄薪資入帳')
    const saved = await apiRequest(`/salary-deposits/${encodeURIComponent(deposit.id)}`, {
      method: 'PUT',
      body: deposit,
    })
    notify()
    return saved
  },
  async remove(id) {
    if (!authToken.value) throw new Error('請先登入')
    await apiRequest(`/salary-deposits/${encodeURIComponent(id)}`, { method: 'DELETE' })
    notify()
  },
}

export async function getGuestLedgerSnapshot() {
  const [guestPassengers, guestTrips, guestExpenses] = await Promise.all([
    passengers.list(),
    trips.list(),
    expenses.list(),
  ])
  return { passengers: guestPassengers, trips: guestTrips, expenses: guestExpenses }
}
