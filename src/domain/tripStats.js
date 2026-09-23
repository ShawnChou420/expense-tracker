import { getWeekRange, isDateInRange } from './date.js'
import { sumCents } from './money.js'

export function getTripStats({ trips = [], passengers = [], referenceDate }) {
  const range = getWeekRange(referenceDate)
  if (!range)
    return {
      range: null,
      receivableCents: 0,
      paidCents: 0,
      pendingCents: 0,
      outstandingByPassenger: [],
      passengerSummaries: [],
    }
  const passengerMap = new Map(passengers.map((passenger) => [passenger.id, passenger]))
  const summaries = new Map()

  for (const trip of trips.filter((item) => isDateInRange(item.date, range))) {
    for (const charge of trip.charges || []) {
      const passenger = passengerMap.get(charge.passengerId)
      const summary = summaries.get(charge.passengerId) || {
        passengerId: charge.passengerId,
        passengerName: passenger?.name || '已停用乘客',
        tripCount: 0,
        totalCents: 0,
        paidCents: 0,
        pendingCents: 0,
      }
      summary.tripCount += 1
      summary.totalCents += charge.amountCents
      if (charge.paymentStatus === 'PAID') summary.paidCents += charge.amountCents
      else summary.pendingCents += charge.amountCents
      summaries.set(charge.passengerId, summary)
    }
  }

  const passengerSummaries = [...summaries.values()].sort(
    (a, b) => b.pendingCents - a.pendingCents || a.passengerName.localeCompare(b.passengerName),
  )
  return {
    range,
    receivableCents: sumCents(passengerSummaries.map((summary) => summary.totalCents)),
    paidCents: sumCents(passengerSummaries.map((summary) => summary.paidCents)),
    pendingCents: sumCents(passengerSummaries.map((summary) => summary.pendingCents)),
    outstandingByPassenger: passengerSummaries.filter((summary) => summary.pendingCents > 0),
    passengerSummaries,
  }
}
