import { nextTick, watch } from 'vue'
import { apiRequest, authToken } from '../services/authSession.js'
import { normalizeWorkRecord } from '../utils/workRecord.js'

export function useWorkRecordsPersistence(records, onError) {
  let guestRecords = []
  let memberIds = new Set()
  let paused = false
  let queue = Promise.resolve()

  watch(
    records,
    (next) => {
      const snapshot = next.map((record) => ({ ...record }))
      if (!authToken.value) {
        guestRecords = snapshot
        return
      }
      if (paused) return
      const token = authToken.value
      queue = queue
        .then(async () => {
          if (token !== authToken.value) return
          const nextIds = new Set(snapshot.map((record) => String(record.id)))
          for (const record of snapshot) {
            await apiRequest(`/work-records/${encodeURIComponent(record.id)}`, {
              method: 'PUT',
              body: record,
            })
          }
          for (const id of memberIds) {
            if (!nextIds.has(id))
              await apiRequest(`/work-records/${encodeURIComponent(id)}`, { method: 'DELETE' })
          }
          memberIds = nextIds
        })
        .catch(onError)
    },
    { deep: true },
  )

  async function loadMemberRecords() {
    paused = true
    try {
      const loaded = await apiRequest('/work-records')
      records.value = loaded.map(normalizeWorkRecord)
      memberIds = new Set(records.value.map((record) => String(record.id)))
      await nextTick()
    } finally {
      paused = false
    }
  }

  async function restoreGuestRecords() {
    paused = true
    records.value = guestRecords.map((record) => ({ ...record }))
    memberIds = new Set()
    await nextTick()
    paused = false
  }

  return {
    getGuestRecords: () => guestRecords.map((record) => ({ ...record })),
    loadMemberRecords,
    restoreGuestRecords,
    flush: () => queue,
  }
}
