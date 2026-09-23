/** Temporary adapters only. Closing or restarting the app clears all records. */
export function createInMemoryPassengerRepository(initialPassengers = []) {
  let passengers = [...initialPassengers]
  return {
    async list() {
      return [...passengers]
    },
    async save(passenger) {
      const index = passengers.findIndex((item) => item.id === passenger.id)
      passengers =
        index === -1
          ? [...passengers, passenger]
          : passengers.map((item) => (item.id === passenger.id ? passenger : item))
      return passenger
    },
  }
}

export function createInMemoryTripRepository(initialTrips = []) {
  let trips = [...initialTrips]
  return {
    async list() {
      return [...trips]
    },
    async listByDateRange(start, end) {
      return trips.filter((trip) => trip.date >= start && trip.date <= end)
    },
    async save(trip) {
      const index = trips.findIndex((item) => item.id === trip.id)
      trips =
        index === -1 ? [...trips, trip] : trips.map((item) => (item.id === trip.id ? trip : item))
      return trip
    },
    async remove(id) {
      trips = trips.filter((trip) => trip.id !== id)
    },
  }
}
