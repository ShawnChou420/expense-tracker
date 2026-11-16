/// <reference types="vite/client" />
import { computed, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { isPerfTraceEnabled, parseServerTiming, recordRequest } from './perfTrace.js'

/** @type {import('vue').Ref<string | null>} */
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

/** 請求超過這個時間仍未回應，就顯示「伺服器啟動中」提示（免費方案閒置後喚醒約需 1 分鐘） */
export const SLOW_REQUEST_MS = 4000
/** 超過這個時間放棄等待；冷啟動通常在這之內完成 */
export const REQUEST_TIMEOUT_MS = 120_000
/** 目前是否有請求等待超過 SLOW_REQUEST_MS，畫面據此顯示提示 */
export const serverSlow = ref(false)
let slowRequests = 0

/** 同時發出的相同 GET（同一個登入身分、同一個路徑）共用一次網路請求 */
const inflightGets = new Map()

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
export function apiRequest(path, { method = 'GET', body } = {}) {
  if (method !== 'GET') return send(path, method, body)
  const key = `${authToken.value || ''} ${path}`
  let shared = inflightGets.get(key)
  if (!shared) {
    shared = send(path, method, body).finally(() => inflightGets.delete(key))
    inflightGets.set(key, shared)
  }
  // 每個呼叫端拿到自己的複本，避免共用同一個物件時互相修改
  return shared.then((result) => (result === null ? null : structuredClone(result)))
}

/** @param {string} path @param {string} method @param {unknown} body */
async function send(path, method, body) {
  let response
  const startedAt = performance.now()
  const trace = (/** @type {number} */ status) => {
    if (!isPerfTraceEnabled()) return
    recordRequest({
      method,
      path,
      status,
      ms: performance.now() - startedAt,
      server: parseServerTiming(response?.headers?.get('Server-Timing')),
    })
  }
  let markedSlow = false
  const slowTimer = setTimeout(() => {
    markedSlow = true
    slowRequests += 1
    serverSlow.value = true
  }, SLOW_REQUEST_MS)
  const controller = new AbortController()
  const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    try {
      response = await fetch(endpoint(path), {
        method,
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      trace(0)
      if (controller.signal.aborted) {
        const timeout = new Error('伺服器回應逾時，暫時無法連線，請稍後再試')
        Object.assign(timeout, { code: 'TIMEOUT' })
        throw timeout
      }
      throw new Error('無法連線到後端，請檢查網路與 API 設定')
    }
    trace(response.status)
    if (response.status === 401 && authToken.value) {
      clearSession()
      throw new Error('登入已失效，請重新登入')
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || error.message || `操作失敗（${response.status}）`)
    }
    return response.status === 204 ? null : await response.json()
  } finally {
    clearTimeout(slowTimer)
    clearTimeout(timeoutTimer)
    if (markedSlow) {
      slowRequests -= 1
      if (slowRequests === 0) serverSlow.value = false
    }
  }
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

/**
 * 後端是否啟用 Email 驗證（沒有設定寄信服務時，註冊不需要驗證碼、也不提供忘記密碼）。
 * 連不上後端時回傳 null。
 * @returns {Promise<{ emailVerification: boolean } | null>}
 */
export async function getAuthConfig() {
  try {
    return await apiRequest('/auth/config')
  } catch {
    // 連不上時不要猜「不需要驗證碼」：回傳 null，由畫面在送出前重新確認
    return null
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
