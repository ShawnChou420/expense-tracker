import { isDateInRange } from './date.js'
import { sumCents } from './money.js'

export const TRIP_TYPES = ['WORK', 'LEISURE', 'OTHER']
export const TRIP_MODES = ['ONE_WAY', 'ROUND_TRIP', 'CUSTOM']
export const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID']

const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function createPassenger(input = {}) {
  return {
    id: input.id || createId('passenger'),
    name: String(input.name || '').trim(),
    active: input.active !== false,
    defaultOneWayFareCents: Number.isInteger(input.defaultOneWayFareCents)
      ? input.defaultOneWayFareCents
      : null,
    defaultRoundTripFareCents: Number.isInteger(input.defaultRoundTripFareCents)
      ? input.defaultRoundTripFareCents
      : null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function createTrip(input = {}) {
  const charges = Array.isArray(input.charges) ? input.charges : []
  return {
    id: input.id || createId('trip'),
    date: String(input.date || ''),
    type: TRIP_TYPES.includes(input.type) ? input.type : 'WORK',
    tripMode: TRIP_MODES.includes(input.tripMode) ? input.tripMode : 'ONE_WAY',
    note: String(input.note || '').trim(),
    charges: charges.map((charge) => ({
      passengerId: String(charge.passengerId || ''),
      amountCents:
        Number.isInteger(charge.amountCents) && charge.amountCents >= 0 ? charge.amountCents : 0,
      amountStatus: ['UNSET', 'DEFAULT', 'CUSTOM', 'FREE'].includes(charge.amountStatus)
        ? charge.amountStatus
        : undefined,
      paymentStatus: PAYMENT_STATUSES.includes(charge.paymentStatus)
        ? charge.paymentStatus
        : 'PENDING',
      paidAt: charge.paidAt || undefined,
      payments: Array.isArray(charge.payments) ? charge.payments : undefined,
    })),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function getPassengerDefaultFareCents(passenger, tripMode) {
  if (tripMode === 'ONE_WAY') return passenger?.defaultOneWayFareCents ?? null
  if (tripMode === 'ROUND_TRIP') return passenger?.defaultRoundTripFareCents ?? null
  return null
}

export function getFareBackfillCandidates(trips, passenger, range, changedModes) {
  if (!range) return []
  return trips.flatMap((trip) => {
    if (!isDateInRange(trip.date, range) || !changedModes.includes(trip.tripMode)) return []
    const fareCents = getPassengerDefaultFareCents(passenger, trip.tripMode)
    if (!Number.isSafeInteger(fareCents) || fareCents <= 0) return []
    return (trip.charges || [])
      .filter(
        (charge) =>
          charge.passengerId === passenger.id &&
          charge.paymentStatus === 'PENDING' &&
          charge.amountStatus === 'UNSET' &&
          charge.amountCents === 0,
      )
      .map(() => ({ tripId: trip.id, date: trip.date, mode: trip.tripMode, fareCents }))
  })
}

export function applyFareBackfill(trips, passengerId, candidates) {
  const amounts = new Map(candidates.map((item) => [item.tripId, item.fareCents]))
  return trips.map((trip) => {
    const fareCents = amounts.get(trip.id)
    if (fareCents === undefined) return trip
    return {
      ...trip,
      charges: trip.charges.map((charge) =>
        charge.passengerId === passengerId &&
        charge.paymentStatus === 'PENDING' &&
        charge.amountStatus === 'UNSET' &&
        charge.amountCents === 0
          ? { ...charge, amountCents: fareCents, amountStatus: 'DEFAULT' }
          : charge,
      ),
    }
  })
}

export function getTripReceivableCents(trip) {
  return sumCents(trip.charges.map((charge) => charge.amountCents))
}

export function getChargeReceivedCents(charge) {
  if (Array.isArray(charge.payments)) {
    return sumCents(charge.payments.map((payment) => payment.amountCents))
  }
  return charge.paymentStatus === 'PAID' ? charge.amountCents : 0
}
