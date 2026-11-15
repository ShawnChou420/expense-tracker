/**
 * P0 效能排查：在瀏覽器記錄每個 API 請求與登入各階段的耗時。
 *
 * 預設關閉。網址加上 `?perf=1` 開啟（會記在這台裝置，`?perf=0` 關閉），之後在開發者工具 Console：
 *   __perf.summary()  依路徑彙總次數、p50／p95、伺服器端拆解
 *   __perf.entries    原始紀錄
 *   __perf.clear()    清空，重新量測
 *
 * 只記錄方法、路徑（不含查詢字串）、狀態碼與耗時，不記錄 Email、token 或回應內容；資料只留在記憶體。
 */

const STORAGE_KEY = 'expense-tracker.perf'
const MAX_ENTRIES = 500

/** @typedef {{ kind: 'request', method: string, path: string, status: number, ms: number, server: Record<string, number>, at: number }} RequestEntry */
/** @typedef {{ kind: 'phase', label: string, ms: number, requests: number, duplicates: string[], at: number }} PhaseEntry */

/** @type {Array<RequestEntry | PhaseEntry>} */
const entries = []
let enabled = readEnabled()

function readEnabled() {
  try {
    const flag = new URLSearchParams(globalThis.location?.search || '').get('perf')
    if (flag === '1') globalThis.localStorage?.setItem(STORAGE_KEY, '1')
    if (flag === '0') globalThis.localStorage?.removeItem(STORAGE_KEY)
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isPerfTraceEnabled() {
  return enabled
}

/** 測試用 @param {boolean} value */
export function setPerfTraceEnabled(value) {
  enabled = value
}

const now = () => globalThis.performance?.now?.() ?? Date.now()

/**
 * 解析 `Server-Timing: app;dur=12.3, db;dur=4.5;desc="2 queries", conn;dur=0.1`
 * @param {string | null | undefined} header
 * @returns {Record<string, number>}
 */
export function parseServerTiming(header) {
  /** @type {Record<string, number>} */
  const result = {}
  if (!header) return result
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';')
    const duration = params.map((param) => param.trim()).find((param) => param.startsWith('dur='))
    const value = duration ? Number(duration.slice(4)) : NaN
    if (name && Number.isFinite(value)) result[name.trim()] = value
    const desc = params.map((param) => param.trim()).find((param) => param.startsWith('desc='))
    const queries = desc?.match(/(\d+) queries/)
    if (queries) result.queries = Number(queries[1])
  }
  return result
}

/** 路徑只保留到 /api 之後，去掉查詢字串；ID 換成 :id 方便彙總 @param {string} path */
export function normalizePath(path) {
  return path
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
    .replace(/\/\d{4}-\d{2}-\d{2}(?=\/|$)/g, '/:date')
    .replace(
      /\/(work-records|expenses|trips|passengers|salary-deposits|payslip-imports|shopping-items)\/[^/]+/g,
      '/$1/:id',
    )
}

/**
 * 依數值排序後取百分位（最近排名法）。樣本少於 20 筆時 p95 就是最大值，報告時要註明樣本數。
 * @param {number[]} values
 */
export function summarizeDurations(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return { count: 0, min: null, p50: null, p95: null, max: null }
  const pick = (/** @type {number} */ p) =>
    sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
  return {
    count: sorted.length,
    min: sorted[0],
    p50: pick(50),
    p95: pick(95),
    max: sorted[sorted.length - 1],
  }
}

/** @param {Omit<RequestEntry, 'kind' | 'at'>} entry */
export function recordRequest(entry) {
  if (!enabled) return
  entries.push({ kind: 'request', ...entry, path: normalizePath(entry.path), at: now() })
  if (entries.length > MAX_ENTRIES) entries.shift()
}

/**
 * 開始量測一個階段（例如「登入後載入」），回傳結束函式。
 * 結束時會列出這段期間發出幾個請求、哪些路徑重複呼叫。
 * @param {string} label
 */
export function startPerfPhase(label) {
  if (!enabled) return () => {}
  const startedAt = now()
  return () => {
    const requests = /** @type {RequestEntry[]} */ (
      entries.filter((entry) => entry.kind === 'request' && entry.at >= startedAt)
    )
    const counts = new Map()
    for (const request of requests) {
      const key = `${request.method} ${request.path}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const duplicates = [...counts]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `${key} ×${count}`)
    const ms = Math.round(now() - startedAt)
    entries.push({ kind: 'phase', label, ms, requests: requests.length, duplicates, at: now() })
    console.info(
      `[perf] ${label}：${ms} ms，${requests.length} 個請求`,
      duplicates.length ? { 重複: duplicates } : '',
    )
  }
}

/** 依「方法 + 路徑」彙總 @param {Array<RequestEntry | PhaseEntry>} [list] */
export function summarizeRequests(list = entries) {
  /** @type {Map<string, RequestEntry[]>} */
  const groups = new Map()
  for (const entry of list) {
    if (entry.kind !== 'request') continue
    const key = `${entry.method} ${entry.path}`
    groups.set(key, [...(groups.get(key) || []), entry])
  }
  return [...groups].map(([key, items]) => {
    const total = summarizeDurations(items.map((item) => item.ms))
    const server = summarizeDurations(
      items.flatMap((item) => (item.server.app === undefined ? [] : [item.server.app])),
    )
    return {
      request: key,
      count: items.length,
      failed: items.filter((item) => item.status === 0 || item.status >= 400).length,
      p50ms: total.p50 === null ? null : Math.round(total.p50),
      p95ms: total.p95 === null ? null : Math.round(total.p95),
      maxms: total.max === null ? null : Math.round(total.max),
      serverP50ms: server.p50,
    }
  })
}

if (enabled && typeof window !== 'undefined') {
  Object.assign(window, {
    __perf: {
      entries,
      summary() {
        const rows = summarizeRequests()
        console.table(rows)
        console.table(entries.filter((entry) => entry.kind === 'phase'))
        return rows
      },
      clear() {
        entries.length = 0
      },
    },
  })
  console.info('[perf] 已開啟效能紀錄；輸入 __perf.summary() 查看，網址加 ?perf=0 關閉')
}
