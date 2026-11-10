import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const auth = vi.hoisted(() => ({
  token: /** @type {{ value: string | null }} */ ({ value: null }),
  request: vi.fn(),
}))
vi.mock('../src/services/authSession.js', async () => {
  const { ref: vueRef } = await import('vue')
  auth.token = vueRef(null)
  return { authToken: auth.token, apiRequest: auth.request }
})

import { useWorkRecordsPersistence } from '../src/composables/useWorkRecordsPersistence.js'

const record = (id, extra = {}) => ({
  id,
  workDate: `2026-11-${String(id).padStart(2, '0')}`,
  startTime: '23:45',
  endTime: '06:00',
  grossPay: 150,
  designatedWork: false,
  ...extra,
})

/** 等 deep watcher 觸發並讓同步佇列跑完。 */
async function settle(persistence) {
  await nextTick()
  await persistence.flush()
}

const writes = () =>
  auth.request.mock.calls
    .filter(([, options]) => options?.method === 'PUT' || options?.method === 'DELETE')
    .map(([path, options]) => `${options.method} ${path}`)

describe('useWorkRecordsPersistence (login / logout)', () => {
  beforeEach(() => {
    auth.token.value = null
    auth.request.mockReset()
  })

  it('keeps guest edits in memory without calling the API', async () => {
    const records = ref([])
    const persistence = useWorkRecordsPersistence(records, vi.fn())
    records.value = [record(1)]
    await settle(persistence)
    expect(auth.request).not.toHaveBeenCalled()
    expect(persistence.getGuestRecords()).toEqual([record(1)])
  })

  it('loads member records without re-uploading them, then syncs only edits', async () => {
    const records = ref([record(1)])
    const persistence = useWorkRecordsPersistence(records, vi.fn())
    await nextTick()

    auth.token.value = 'member-token'
    auth.request.mockImplementation(async (path, options) =>
      !options ? [record(10), record(11), record(12)] : undefined,
    )
    await persistence.loadMemberRecords()
    await settle(persistence)
    expect(writes()).toEqual([])
    expect(records.value.map((item) => item.id)).toEqual([10, 11, 12])

    records.value[1].remark = 'changed'
    await settle(persistence)
    records.value = records.value.filter((item) => item.id !== 12)
    await settle(persistence)

    expect(writes()).toEqual(['PUT /work-records/11', 'DELETE /work-records/12'])
  })

  it('never pushes guest records into the member account before the member load finishes', async () => {
    const records = ref([record(1), record(2)])
    const persistence = useWorkRecordsPersistence(records, vi.fn())
    await nextTick()

    auth.token.value = 'member-token' // signIn() 已完成，但會員班表尚未載入
    records.value = [...records.value, record(3)]
    await settle(persistence)

    expect(writes()).toEqual([])
  })

  it('restores guest records on logout and stops syncing member changes', async () => {
    const records = ref([])
    const persistence = useWorkRecordsPersistence(records, vi.fn())
    records.value = [record(1)]
    await nextTick()

    auth.token.value = 'member-token'
    auth.request.mockImplementation(async (path, options) => (!options ? [record(20)] : undefined))
    await persistence.loadMemberRecords()
    await settle(persistence)

    auth.token.value = null
    await persistence.restoreGuestRecords()
    records.value = [...records.value, record(2)]
    await settle(persistence)

    expect(records.value.map((item) => item.id)).toEqual([1, 2])
    expect(writes()).toEqual([])
  })
})
