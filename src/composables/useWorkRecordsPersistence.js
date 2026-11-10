import { nextTick, watch } from 'vue'
import { apiRequest, authToken } from '../services/authSession.js'
import { normalizeWorkRecord } from '../utils/workRecord.js'
import { createWorkRecordSync } from './workRecordSync.js'

/**
 * 訪客班表只保存在記憶體；會員班表同步到 API。
 * 會員同步只送出與伺服器上次確認狀態不同的紀錄（見 workRecordSync.js），
 * 而且必須等 loadMemberRecords() 為目前 token 建立基準後才開始，
 * 避免登入過程中把訪客班表誤寫進會員帳號。
 */
export function useWorkRecordsPersistence(records, onError, syncOptions = {}) {
  let guestRecords = []
  const sync = createWorkRecordSync({
    request: apiRequest,
    getToken: () => authToken.value,
    onError,
    ...syncOptions,
  })

  watch(
    records,
    (next) => {
      // 訪客：只更新記憶體中的訪客副本
      if (!authToken.value) {
        guestRecords = next.map((record) => ({ ...record }))
        return
      }
      // 會員：只同步有差異的紀錄
      sync.update(next)
    },
    { deep: true },
  )

  async function loadMemberRecords() {
    const token = authToken.value
    const loaded = await apiRequest('/work-records')
    const normalized = loaded.map(normalizeWorkRecord)
    // 先設定基準再更新畫面，剛載入的紀錄不會被重新上傳
    sync.reset(token, normalized)
    records.value = normalized
    await nextTick()
  }

  async function restoreGuestRecords() {
    // 先停止會員同步，再換回訪客資料
    sync.detach()
    records.value = guestRecords.map((record) => ({ ...record }))
    await nextTick()
  }

  return {
    getGuestRecords: () => guestRecords.map((record) => ({ ...record })),
    loadMemberRecords,
    restoreGuestRecords,
    flush: () => sync.flush(),
    hasPendingChanges: () => sync.hasPendingChanges(),
  }
}
