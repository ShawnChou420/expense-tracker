import { describe, expect, it } from 'vitest'
import { applyFareBackfill, createTrip, getFareBackfillCandidates } from './trips.js'

const range = { start: '2026-09-28', end: '2026-10-04' }
const passenger = { id: 'p', defaultOneWayFareCents: 800, defaultRoundTripFareCents: 1500 }
const trip = (
  id,
  date,
  amountStatus,
  amountCents,
  paymentStatus = 'PENDING',
  tripMode = 'ONE_WAY',
) =>
  createTrip({
    id,
    date,
    tripMode,
    charges: [{ passengerId: 'p', amountCents, amountStatus, paymentStatus }],
  })

describe('default fare backfill', () => {
  it('only offers explicitly unset, unpaid fares in the selected week', () => {
    const trips = [
      trip('unset', '2026-09-28', 'UNSET', 0),
      trip('free', '2026-09-29', 'FREE', 0),
      trip('legacy', '2026-09-30', undefined, 0),
      trip('custom', '2026-10-01', 'CUSTOM', 500),
      trip('paid', '2026-10-02', 'UNSET', 0, 'PAID'),
      trip('last-week', '2026-09-27', 'UNSET', 0),
      trip('round', '2026-10-03', 'UNSET', 0, 'PENDING', 'ROUND_TRIP'),
    ]
    const candidates = getFareBackfillCandidates(trips, passenger, range, ['ONE_WAY'])
    expect(candidates).toEqual([
      { tripId: 'unset', date: '2026-09-28', mode: 'ONE_WAY', fareCents: 800 },
    ])
    const updated = applyFareBackfill(trips, passenger.id, candidates)
    expect(updated[0].charges[0]).toMatchObject({ amountCents: 800, amountStatus: 'DEFAULT' })
    expect(updated.slice(1)).toEqual(trips.slice(1))
    expect(getFareBackfillCandidates(updated, passenger, range, ['ONE_WAY'])).toEqual([])
  })

  it('uses each mode rate and never backfills absent or zero defaults', () => {
    const trips = [trip('round', '2026-10-04', 'UNSET', 0, 'PENDING', 'ROUND_TRIP')]
    expect(getFareBackfillCandidates(trips, passenger, range, ['ROUND_TRIP'])[0].fareCents).toBe(
      1500,
    )
    expect(
      getFareBackfillCandidates(trips, { ...passenger, defaultRoundTripFareCents: 0 }, range, [
        'ROUND_TRIP',
      ]),
    ).toEqual([])
  })
})
