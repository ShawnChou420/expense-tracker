/// <reference types="vite/client" />
import { computed, ref } from 'vue'
import { Capacitor } from '@capacitor/core'

export const authToken = ref(null)
export const authEmail = ref('')
export const isAuthenticated = computed(() => Boolean(authToken.value))

// 登入狀態保存在這台裝置上：重新整理或關掉 App 都不會登出，直到主動登出或登入過期（後端 30 天、使用中會自動延長）
const SESSION_KEY = 'expense-tracker.session'
function saveSession(result) {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: result.token, email: result.email, expiresAt: result.expiresAt }),
    )
  } catch {
    // 無痕模式或停用儲存時，只維持這次開啟期間的登入
  }
}
function forgetSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

const configuredBase = import.meta.env?.VITE_API_BASE_URL?.replace(/\/$/, '') || ''
export const isApiAvailable = !Capacitor.isNativePlatform() || configuredBase.startsWith('https://')

function endpoint(path) {
  if (!isApiAvailable) throw new Error('原生 App 必須設定 HTTPS 的 VITE_API_BASE_URL')
  return `${configuredBase || '/api'}${path}`
}

/** @param {string} path @param {{ method?: string, body?: unknown }} [options] */
export async function apiRequest(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(endpoint(path), {
      method,
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error('無法連線到後端，請檢查網路與 API 設定')
  }
  if (response.status === 401 && authToken.value) {
    clearSession()
    throw new Error('登入已失效，請重新登入')
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || error.message || `操作失敗（${response.status}）`)
  }
  return response.status === 204 ? null : response.json()
}

/**
 * 登入、註冊（可附 Email 驗證碼）或用驗證碼重設密碼；成功後直接登入。
 * @param {'login' | 'register' | 'reset-password'} mode
 * @param {string} email @param {string} password @param {string} [code]
 */
export async function signIn(mode, email, password, code) {
  const result = await apiRequest(`/auth/${mode}`, {
    method: 'POST',
    body: code ? { email, password, code } : { email, password },
  })
  authToken.value = result.token
  authEmail.value = result.email
  saveSession(result)
  return result
}

/**
 * App 啟動時恢復上次的登入。向後端確認登入仍有效才算成功；失效就清掉。
 * @returns {Promise<boolean>}
 */
export async function restoreSavedSession() {
  /** @type {{ token?: string, email?: string } | null} */
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    saved = null
  }
  // 不在前端判斷期限：後端使用中會自動延長，由後端決定是否仍有效
  if (!saved?.token) {
    forgetSession()
    return false
  }
  authToken.value = saved.token
  authEmail.value = saved.email || ''
  try {
    const me = await apiRequest('/auth/me')
    authEmail.value = me.email
    return true
  } catch (/** @type {any} */ error) {
    // 網路暫時不通時保留登入，讓使用者稍後重試；只有後端明確拒絕才登出
    if (!authToken.value) return false
    if (String(error?.message || '').includes('無法連線')) {
      authToken.value = null
      return false
    }
    clearSession()
    return false
  }
}

/** 後端是否啟用 Email 驗證（沒有設定寄信服務時，註冊不需要驗證碼、也不提供忘記密碼） */
export async function getAuthConfig() {
  try {
    return await apiRequest('/auth/config')
  } catch {
    return { emailVerification: false }
  }
}

/** @param {string} email @param {'REGISTER' | 'RESET_PASSWORD'} purpose */
export function requestEmailCode(email, purpose) {
  return apiRequest('/auth/email-code', { method: 'POST', body: { email, purpose } })
}

export async function signOut() {
  if (authToken.value) {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } finally {
      clearSession()
    }
  }
}

export function clearSession() {
  forgetSession()
  authToken.value = null
  authEmail.value = ''
}
