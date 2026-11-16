import { apiRequest, authToken } from '../services/authSession.js'
import { normalizeVisaJourney } from '../domain/visaJourney.js'

// 訪客的集簽設定只保存在記憶體；會員保存在 PostgreSQL（visa_journey）。
/** @type {import('../domain/visaJourney.js').VisaJourneySettings | null} */
let guestJourney = null

export const visaJourneyRepository = {
  /** 尚未設定時回傳 null（首頁顯示首次設定） */
  async load() {
    if (!authToken.value) return guestJourney ? { ...guestJourney } : null
    const result = await apiRequest('/visa-journey')
    return result?.journey ? normalizeVisaJourney(result.journey) : null
  },
  /** @param {import('../domain/visaJourney.js').VisaJourneySettings} settings */
  async save(settings) {
    const journey = normalizeVisaJourney(settings)
    if (!authToken.value) {
      guestJourney = journey
      return { ...journey }
    }
    const result = await apiRequest('/visa-journey', { method: 'PUT', body: journey })
    return normalizeVisaJourney(result?.journey)
  },
}

export function getGuestVisaJourney() {
  return guestJourney ? { ...guestJourney } : null
}
