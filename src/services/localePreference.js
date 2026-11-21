// 語系偏好：訪客存 localStorage；會員另外綁定帳號（user_preferences.language）。
// 只改畫面語言，不碰顯示貨幣或任何薪資、財務資料。
import { apiRequest, authToken } from './authSession.js'
import { applyLocale } from '../i18n/index.js'
import { normalizeLocale } from '../domain/locale.js'

/**
 * 使用者主動切換語言：立即更新畫面；會員再寫回帳號。
 * 寫回失敗時畫面仍維持新語言，並把錯誤丟給呼叫端提示。
 * @param {string} locale
 */
export async function changeLocale(locale) {
  const next = applyLocale(locale)
  if (authToken.value) {
    await apiRequest('/dashboard-settings/language', { method: 'PUT', body: { language: next } })
  }
  return next
}

/**
 * 登入後套用帳號上的語言；帳號尚未設定（null）時沿用目前畫面語言。
 * @param {unknown} accountLocale
 */
export function applyAccountLocale(accountLocale) {
  const locale = normalizeLocale(accountLocale)
  if (locale) applyLocale(locale)
  return locale
}
