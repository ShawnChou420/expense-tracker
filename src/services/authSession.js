/// <reference types="vite/client" />
import { computed, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { isPerfTraceEnabled, parseServerTiming, recordRequest } from './perfTrace.js'

/** @type {import('vue').Ref<string | null>} */
export const authToken = ref(null)
export const authEmail = ref('')
export const isAuthenticated = computed(() => Boolean(authToken.value))
/** 登入者的角色（後端回傳）；只用來決定是否顯示管理後台入口，權限一律由後端驗證 */
/** @type {import('vue').Ref<string[]>} */
export const authRoles = ref([])
export const isSuperAdmin = computed(() => authRoles.value.includes('SUPER_ADMIN'))

/** 每個請求一個 ID（X-Request-Id），出錯時可以用它對照伺服器紀錄 */
function newRequestId() {
  try {
    return globalThis.crypto.randomUUID().slice(0, 13)
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }
}

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

let wakeRequested = false
/**
 * 打開 App 時先叫醒後端（免費方案閒置會休眠，喚醒要等一陣子）。
 * 只在每次開啟 App 時送一次，不重試、不定時重送；失敗也不影響畫面。
 * 使用者還在看首頁或輸入帳密時，伺服器就已經在啟動，登入時等待會短很多。
 */
export function wakeServer() {
  if (wakeRequested || !isApiAvailable) return
  wakeRequested = true
  try {
    // 讀完回應內容，讓這個請求確實結束（未讀取的回應會讓連線一直處於進行中）
    fetch(endpoint('/health'), { credentials: 'omit' })
      .then((response) => response.text())
      .catch(() => {})
  } catch {
    // 不支援 fetch 或網址錯誤時略過
  }
}

/**
 * 回報只有前端知道的事件（例如薪資單 PDF 在瀏覽器解析失敗）。只送事件類型、錯誤代碼與數字；
 * 訪客不送；失敗也不影響畫面。
 * @param {'PAYSLIP_IMPORT_FAILED' | 'FILL_MONTH_COMPLETED'} type
 * @param {{ status?: 'SUCCESS' | 'FAILURE', errorCode?: string, details?: Record<string, number | boolean | string> }} [info]
 */
export function reportEvent(type, info = {}) {
  if (!authToken.value) return
  apiRequest('/events', { method: 'POST', body: { type, ...info } }).catch(() => {})
}

/** 後端還在啟動時常見的狀態碼：/api/ready 的 503、雲端平台喚醒期間的 502／504 */
const STARTING_STATUSES = new Set([502, 503, 504])

/**
 * App 開啟時等後端（含資料庫）準備好再顯示畫面：免費方案閒置會休眠，喚醒期間的請求容易失敗。
 * 每 1.5 秒問一次 /api/ready，最多等 timeoutMs；逾時、離線或其他錯誤就放行，交給各畫面自己的錯誤處理。
 * @param {{ timeoutMs?: number, intervalMs?: number, maxNetworkErrors?: number }} [options]
 * @returns {Promise<boolean>} 是否確認已就緒
 */
export async function waitForBackendReady({ timeoutMs = 90_000, intervalMs = 1500, maxNetworkErrors = 3 } = {}) {
  if (!isApiAvailable) return false
  wakeRequested = true
  const deadline = Date.now() + timeoutMs
  let networkErrors = 0
  while (Date.now() < deadline) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1000, deadline - Date.now()))
    try {
      const response = await fetch(endpoint('/ready'), { credentials: 'omit', signal: controller.signal })
      await response.text().catch(() => '')
      if (response.ok) return true
      // 舊版後端沒有 /api/ready（404）或其他非啟動中的錯誤：不再等
      if (!STARTING_STATUSES.has(response.status)) return false
    } catch {
      // 離線時很快就會失敗，不要讓使用者一直等
      networkErrors += 1
      if (networkErrors >= maxNetworkErrors) return false
    } finally {
      clearTimeout(timer)
    }
    if (Date.now() + intervalMs >= deadline) break
    await new Promise((done) => setTimeout(done, intervalMs))
  }
  return false
}

/** 上次保存的登入在這次開啟時已失效（例如在別台裝置改了密碼）；畫面據此提示一次 */
export const sessionExpired = ref(false)

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

/**
 * @param {string} path @param {string} method @param {unknown} body
 * @param {string | null} [token] 這個請求要帶的登入憑證（預設為目前的登入）
 */
async function send(path, method, body, token = authToken.value) {
  let response
  const requestId = newRequestId()
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
          'X-Request-Id': requestId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (response.status === 401 && token) {
      // 只有「目前這個登入」被拒絕才登出；舊憑證的請求晚回來時不重複登出、也不顯示「操作失敗（401）」
      if (token === authToken.value) clearSession()
      const expired = new Error('登入已失效，請重新登入')
      Object.assign(expired, { status: 401, code: 'SESSION_EXPIRED' })
      throw expired
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      const failure = new Error(error.detail || error.message || `操作失敗（${response.status}）`)
      Object.assign(failure, { status: response.status, requestId: response.headers?.get?.('X-Request-Id') || requestId })
      throw failure
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
  authRoles.value = Array.isArray(result.roles) ? result.roles : []
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
  // 先向後端確認，確認有效才設為登入中：避免各畫面拿失效的憑證同時送出請求、跳出一堆錯誤
  try {
    const me = await send('/auth/me', 'GET', undefined, saved.token)
    authToken.value = saved.token
    authEmail.value = me.email || saved.email || ''
    authRoles.value = Array.isArray(me.roles) ? me.roles : []
    return true
  } catch (/** @type {any} */ error) {
    // 後端明確拒絕才清掉；網路不通或伺服器還沒好時保留，下次開啟再試
    if (error?.status === 401 || error?.status === 403) {
      forgetSession()
      sessionExpired.value = true
    }
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
  authRoles.value = []
}
