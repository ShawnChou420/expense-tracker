/**
 * @typedef {Object} PassengerRepository
 * @property {() => Promise<Array<object>>} list
 * @property {(passenger: object) => Promise<object>} save
 */

/**
 * @typedef {Object} TripRepository
 * @property {() => Promise<Array<object>>} list
 * @property {(start: string, end: string) => Promise<Array<object>>} listByDateRange
 * @property {(trip: object) => Promise<object>} save
 * @property {(id: string) => Promise<void>} remove
 */

export {}
