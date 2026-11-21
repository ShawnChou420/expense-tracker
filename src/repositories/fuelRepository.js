import { apiRequest } from '../services/authSession.js'
import { buildFuelQueryPath } from '../domain/fuel.js'

/**
 * 首頁油價卡：NSW 公開油價（訪客與會員共用後端端點，不含會員資料）。
 * 偏好只存在這台裝置的 localStorage；讀寫失敗（私密模式等）就用預設值。
 */
const PREFS_KEY = 'expense-tracker.fuel-prefs'

export const fuelRepository = {
  /**
   * @param {{ fuelType: string, postcode?: string, latitude?: number, longitude?: number }} query
   * @returns {Promise<{ fuelType: string, fetchedAt: string, stale: boolean, stations: Array<any> }>}
   */
  async nearby(query) {
    const path = buildFuelQueryPath(query)
    if (!path) throw new Error('請先設定郵遞區號或使用目前位置')
    return apiRequest(path)
  },

  loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    } catch {
      return null
    }
  },

  savePrefs(/** @type {unknown} */ prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // 無法儲存時只影響下次開啟要重新設定
    }
  },
}
