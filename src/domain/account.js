// 會員資料頁的驗證與顯示邏輯；規則需與後端 AccountController 一致。
import { passwordPolicyError } from './password.js'

export const NICKNAME_MAX_LENGTH = 50

/**
 * 去除前後空白；空字串代表清除顯示名稱。
 * @param {string | null | undefined} [value]
 */
export function normalizeNickname(value = '') {
  return String(value ?? '').trim()
}

/**
 * 顯示名稱合法時回傳空字串，否則回傳錯誤訊息（以 Unicode 字元計長度）。
 * @param {string | null | undefined} [value]
 */
export function nicknameError(value = '') {
  const nickname = normalizeNickname(value)
  if ([...nickname].length > NICKNAME_MAX_LENGTH) return `顯示名稱最多 ${NICKNAME_MAX_LENGTH} 個字`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(nickname)) return '顯示名稱含有不支援的字元'
  return ''
}

/**
 * 修改密碼表單檢查；新密碼套用註冊規則（src/domain/password.js）。
 * @param {{ currentPassword?: string, newPassword?: string, confirmPassword?: string }} form
 */
export function passwordChangeError({
  currentPassword = '',
  newPassword = '',
  confirmPassword = '',
}) {
  if (!currentPassword) return '請輸入目前密碼'
  const policyError = passwordPolicyError(newPassword)
  if (policyError) return policyError
  if (newPassword !== confirmPassword) return '兩次輸入的新密碼不一致'
  if (newPassword === currentPassword) return '新密碼不可與目前密碼相同'
  return ''
}

/** 後端回傳的 ISO 時間轉為本地 YYYY-MM-DD；無效時回傳「—」。 */
export function formatRegisteredDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
