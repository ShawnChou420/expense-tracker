import { apiRequest, authToken } from '../services/authSession.js'
import { normalizeBlackoutNotice, upsertBlackoutNotice } from '../domain/leaveBlackouts.js'

// 訪客的禁休公告只保存在記憶體；會員保存在 PostgreSQL（leave_blackout_notice）。
/** @type {Array<ReturnType<typeof normalizeBlackoutNotice>>} */
let guestNotices = []

export const blackoutNoticeRepository = {
  async list() {
    if (authToken.value) return (await apiRequest('/blackout-notices')).map(normalizeBlackoutNotice)
    return guestNotices.map((item) => ({ ...item }))
  },
  /** @param {any} value */
  async save(value) {
    const notice = normalizeBlackoutNotice(value)
    if (authToken.value)
      return normalizeBlackoutNotice(
        await apiRequest(`/blackout-notices/${encodeURIComponent(notice.id)}`, {
          method: 'PUT',
          body: notice,
        }),
      )
    guestNotices = upsertBlackoutNotice(guestNotices, notice)
    return notice
  },
  /** @param {string} id */
  async remove(id) {
    if (authToken.value)
      return apiRequest(`/blackout-notices/${encodeURIComponent(id)}`, { method: 'DELETE' })
    guestNotices = guestNotices.filter((item) => item.id !== id)
    return null
  },
}

export function getGuestBlackoutNotices() {
  return guestNotices.map((item) => ({ ...item }))
}
