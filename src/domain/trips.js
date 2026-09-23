import { sumCents } from './money.js'

export const TRIP_TYPES = ['WORK', 'LEISURE', 'OTHER']
export const TRIP_MODES = ['ONE_WAY', 'ROUND_TRIP', 'CUSTOM']
export const PAYMENT_STATUSES = ['PENDING', 'PAID']

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
      paymentStatus: PAYMENT_STATUSES.includes(charge.paymentStatus)
        ? charge.paymentStatus
        : 'PENDING',
      paidAt: charge.paidAt || undefined,
    })),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function getPassengerDefaultFareCents(passenger, tripMode) {
  if (tripMode === 'ONE_WAY') return passenger.defaultOneWayFareCents || 0
  if (tripMode === 'ROUND_TRIP') return passenger.defaultRoundTripFareCents || 0
  return 0
}

export function getTripReceivableCents(trip) {
  return sumCents(trip.charges.map((charge) => charge.amountCents))
}
