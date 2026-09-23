import { describe, expect, it } from 'vitest'
import { getWeekRange, isDateInRange } from '../src/domain/date.js'
import { dollarsToCents, formatAud, sumCents } from '../src/domain/money.js'
import { getTripStats } from '../src/domain/tripStats.js'
import {
  createInMemoryPassengerRepository,
  createInMemoryTripRepository,
} from '../src/repositories/inMemoryTripRepositories.js'

describe('money domain', () => {
  it('uses cents for arithmetic and AUD formatting', () => {
    expect(dollarsToCents('8.25')).toBe(825)
    expect(sumCents([825, 175, 0])).toBe(1000)
    expect(formatAud(1000)).toBe('$10.00')
  })
})

describe('local date domain', () => {
  it('uses Monday through Sunday week boundaries without UTC conversion', () => {
    const range = getWeekRange('2026-09-20')
    expect(range).toEqual({ start: '2026-09-14', end: '2026-09-20' })
    expect(isDateInRange('2026-09-14', range)).toBe(true)
    expect(isDateInRange('2026-09-21', range)).toBe(false)
  })
})

describe('trip statistics', () => {
  it('separates received and pending fares while retaining all receivables', () => {
    const stats = getTripStats({
      referenceDate: '2026-09-20',
      passengers: [
        { id: 'kim', name: 'Kim' },
        { id: 'john', name: 'John' },
      ],
      trips: [
        {
          date: '2026-09-20',
          charges: [
            { passengerId: 'kim', amountCents: 800, paymentStatus: 'PAID' },
            { passengerId: 'john', amountCents: 800, paymentStatus: 'PENDING' },
          ],
        },
      ],
    })
    expect(stats.receivableCents).toBe(1600)
    expect(stats.paidCents).toBe(800)
    expect(stats.pendingCents).toBe(800)
    expect(stats.outstandingByPassenger).toEqual([
      expect.objectContaining({ passengerName: 'John', pendingCents: 800 }),
    ])
  })
})

describe('temporary repositories', () => {
  it('supports independent passenger and trip CRUD without browser storage', async () => {
    const passengerRepository = createInMemoryPassengerRepository()
    const tripRepository = createInMemoryTripRepository()
    await passengerRepository.save({ id: 'kim', name: 'Kim', active: true })
    await tripRepository.save({ id: 'trip-1', date: '2026-09-20', charges: [] })
    expect(await passengerRepository.list()).toHaveLength(1)
    expect(await tripRepository.listByDateRange('2026-09-14', '2026-09-20')).toHaveLength(1)
    await tripRepository.remove('trip-1')
    expect(await tripRepository.list()).toEqual([])
  })
})
