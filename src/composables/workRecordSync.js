/**
 * 班表會員同步：只送出有變動的紀錄（不依賴 Vue，方便單元測試）。
 *
 * - `synced`：目前會員 token 下，伺服器已確認保存的內容。
 * - `desired`：本機最新的班表快照。
 * 只有序列化 JSON 不同的 id 才會 PUT；本機已不存在的 id 才會 DELETE。
 * 請求一次只送一筆，每一步都重新讀取最新快照，所以快速連續編輯會合併成最新值，
 * 不會把每次中間編輯都重送一遍。
 * 失敗的項目保留為待同步，依退避時間自動重試（下次編輯或 flush 時也會再試）。
 */

/** 自動重試的等待時間（毫秒）：依序 2、5、15、30、60 秒，用完就等下次編輯或 flush。 */
export const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000]

/** 把紀錄陣列轉成 id → JSON 字串的 Map，用來比對內容是否改變。 @param {Array<{ id: unknown }>} records */
export function serializeRecords(records) {
  const map = new Map()
  for (const record of records) map.set(String(record.id), JSON.stringify(record))
  return map
}

/** 比對伺服器狀態與本機快照，回傳要刪除與要上傳的 id。 @param {Map<string, string>} synced @param {Map<string, string>} desired */
export function diffRecordSnapshots(synced, desired) {
  const deletes = []
  const puts = []
  for (const id of synced.keys()) if (!desired.has(id)) deletes.push(id)
  for (const [id, json] of desired) if (synced.get(id) !== json) puts.push(id)
  return { deletes, puts }
}

/**
 * @param {{
 *   request: (path: string, options?: { method?: string, body?: unknown }) => Promise<unknown>,
 *   getToken: () => string | null,
 *   onError?: (error: any) => void,
 *   retryDelays?: number[],
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 * }} options
 */
export function createWorkRecordSync({
  request,
  getToken,
  onError = () => {},
  retryDelays = DEFAULT_RETRY_DELAYS_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
}) {
  /** `synced` 所屬的 token；訪客模式或尚未載入會員資料時為 null（此時一律不同步）。 */
  let baselineToken = null
  let synced = new Map()
  let desired = new Map()
  /** @type {Promise<void> | null} */
  let running = null // 正在執行的同步流程
  let retryTimer = null // 等待中的自動重試計時器
  let failureStreak = 0 // 連續失敗次數（決定退避時間與是否提示錯誤）

  // 只有 token 與基準一致、且仍是目前登入的 token 時才同步
  const isActive = (token) => token !== null && token === baselineToken && getToken() === token

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimer(retryTimer)
      retryTimer = null
    }
  }

  function hasPendingChanges() {
    const { deletes, puts } = diffRecordSnapshots(synced, desired)
    return deletes.length + puts.length > 0
  }

  function reportError(error) {
    try {
      onError(error)
    } catch {
      /* 錯誤提示本身出錯時，不可中斷同步流程。 */
    }
  }

  /** 逐筆送出差異，直到沒有差異或 token 改變；先刪除再上傳。 */
  async function drain() {
    const token = baselineToken
    const failedThisRun = new Set()
    let lastError = null
    while (isActive(token)) {
      const { deletes, puts } = diffRecordSnapshots(synced, desired)
      const deleteId = deletes.find((id) => !failedThisRun.has(id))
      const putId = deleteId === undefined ? puts.find((id) => !failedThisRun.has(id)) : undefined
      const id = deleteId ?? putId
      if (id === undefined) break
      const path = `/work-records/${encodeURIComponent(id)}`
      try {
        if (deleteId !== undefined) {
          await request(path, { method: 'DELETE' })
          if (token === baselineToken) synced.delete(id) // 已切換帳號就不更新新帳號的基準
        } else {
          const json = /** @type {string} */ (desired.get(id))
          await request(path, { method: 'PUT', body: JSON.parse(json) })
          if (token === baselineToken) synced.set(id, json)
        }
      } catch (error) {
        // 這筆本輪先跳過，其他紀錄繼續同步；稍後自動重試
        failedThisRun.add(id)
        lastError = error
      }
    }
    if (!isActive(token)) return
    if (lastError) {
      // 同一段連續失敗只提示一次錯誤，避免一直跳 toast
      failureStreak += 1
      if (failureStreak === 1) reportError(lastError)
      const delay = retryDelays[failureStreak - 1]
      clearRetry()
      if (delay !== undefined) {
        retryTimer = setTimer(() => {
          retryTimer = null
          schedule()
        }, delay)
      }
    } else {
      failureStreak = 0
      clearRetry()
    }
  }

  function schedule() {
    if (running) return running
    running = drain().finally(() => {
      running = null
      // 迴圈最後一次檢查後到這裡之間若又有編輯，補跑一次
      if (
        retryTimer === null &&
        failureStreak === 0 &&
        isActive(baselineToken) &&
        hasPendingChanges()
      )
        schedule()
    })
    return running
  }

  /** 等到目前沒有同步流程在跑。 */
  async function whenIdle() {
    while (running) await running
  }

  return {
    /** 會員資料載入後呼叫：以 `records` 作為伺服器現況，開始為 `token` 同步。 */
    reset(token, records) {
      clearRetry()
      failureStreak = 0
      baselineToken = token
      synced = serializeRecords(records)
      desired = new Map(synced)
    },
    /** 登出或回到訪客模式：停止同步並清除會員狀態與待重試計時器。 */
    detach() {
      clearRetry()
      failureStreak = 0
      baselineToken = null
      synced = new Map()
      desired = new Map()
    },
    /** 記錄本機最新快照並同步差異。 */
    update(records) {
      if (!isActive(baselineToken)) return Promise.resolve()
      desired = serializeRecords(records)
      // 自動重試已用完時，新的編輯重新開始一輪重試
      if (retryTimer === null) failureStreak = 0
      return schedule().then(whenIdle)
    },
    /** 立即重試待同步的變更（不等退避時間），完成後才 resolve；登出前使用。 */
    async flush() {
      if (isActive(baselineToken) && hasPendingChanges()) {
        clearRetry()
        failureStreak = 0
        schedule()
      }
      await whenIdle()
    },
    /** 是否還有尚未成功保存到伺服器的變更。 */
    hasPendingChanges: () => isActive(baselineToken) && hasPendingChanges(),
  }
}
