import { apiRequest, authToken } from '../services/authSession.js'
import {
  normalizeLeaveBlackout,
  removeLeaveBlackout,
  upsertLeaveBlackout,
} from '../domain/leaveBlackouts.js'

// Guest announcements are session-only; member announcements live in PostgreSQL.
let guestBlackouts = []

export const leaveBlackoutRepository = {
  async list() {
    if (authToken.value) return (await apiRequest('/leave-blackouts')).map(normalizeLeaveBlackout)
    return guestBlackouts.map((item) => ({ ...item }))
  },
  async save(value) {
    const blackout = normalizeLeaveBlackout(value)
    if (authToken.value)
      return apiRequest(`/leave-blackouts/${blackout.date}`, {
        method: 'PUT',
        body: { reason: blackout.reason },
      })
    guestBlackouts = upsertLeaveBlackout(guestBlackouts, blackout)
    return blackout
  },
  async remove(date) {
    if (authToken.value) return apiRequest(`/leave-blackouts/${date}`, { method: 'DELETE' })
    guestBlackouts = removeLeaveBlackout(guestBlackouts, date)
    return null
  },
}

export function getGuestLeaveBlackouts() {
  return guestBlackouts.map((item) => ({ ...item }))
}
