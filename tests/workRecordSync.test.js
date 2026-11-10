import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkRecordSync,
  diffRecordSnapshots,
  serializeRecords,
} from '../src/composables/workRecordSync.js'

const record = (id, extra = {}) => ({
  id,
  workDate: `2026-11-${String(id).padStart(2, '0')}`,
  grossPay: 100,
  ...extra,
})

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {}
  /** @type {(error: unknown) => void} */
  let reject = () => {}
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup({ token = 'token-a', retryDelays = [1000, 2000] } = {}) {
  const state = { token }
  /** @type {Array<{ path: string, method?: string, body?: any }>} */
  const calls = []
  const request = vi.fn(async (path, options = {}) => {
    calls.push({ path, ...options })
  })
  const onError = vi.fn()
  const sync = createWorkRecordSync({ request, getToken: () => state.token, onError, retryDelays })
  return { state, calls, request, onError, sync }
}

describe('diffRecordSnapshots', () => {
  it('lists only changed, new and removed ids', () => {
    const synced = serializeRecords([record(1), record(2), record(3)])
    const desired = serializeRecords([record(1), record(2, { grossPay: 200 }), record(4)])
    expect(diffRecordSnapshots(synced, desired)).toEqual({ deletes: ['3'], puts: ['2', '4'] })
  })
})

describe('createWorkRecordSync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('PUTs only the edited record instead of every record', async () => {
    const { sync, calls } = setup()
    const records = Array.from({ length: 30 }, (_, index) => record(index + 1))
    sync.reset('token-a', records)

    const edited = records.map((item) => (item.id === 7 ? { ...item, remark: '晚到' } : item))
    await sync.update(edited)

    expect(calls).toEqual([
      { path: '/work-records/7', method: 'PUT', body: { ...record(7), remark: '晚到' } },
    ])
  })

  it('sends nothing when the snapshot equals the server baseline', async () => {
    const { sync, calls } = setup()
    sync.reset('token-a', [record(1)])
    await sync.update([{ ...record(1) }])
    expect(calls).toEqual([])
  })

  it('coalesces rapid consecutive edits made while a request is in flight', async () => {
    const { sync, calls, request } = setup()
    sync.reset('token-a', [record(1)])
    const first = deferred()
    request.mockImplementationOnce(async (path, options) => {
      calls.push({ path, ...options })
      await first.promise
    })

    const done = sync.update([record(1, { remark: 'a' })])
    sync.update([record(1, { remark: 'ab' })])
    sync.update([record(1, { remark: 'abc' })])
    first.resolve()
    await done
    await sync.flush()

    expect(calls.map((call) => call.body.remark)).toEqual(['a', 'abc'])
    expect(sync.hasPendingChanges()).toBe(false)
  })

  it('DELETEs only removed records, and re-adding after delete PUTs again', async () => {
    const { sync, calls } = setup()
    sync.reset('token-a', [record(1), record(2), record(3)])

    await sync.update([record(1), record(3)])
    expect(calls).toEqual([{ path: '/work-records/2', method: 'DELETE' }])

    await sync.update([record(1), record(3), record(2)])
    expect(calls[1]).toEqual({ path: '/work-records/2', method: 'PUT', body: record(2) })
  })

  it('deletes a record that was removed while its PUT was still in flight', async () => {
    const { sync, calls, request } = setup()
    sync.reset('token-a', [])
    const put = deferred()
    request.mockImplementationOnce(async (path, options) => {
      calls.push({ path, ...options })
      await put.promise
    })

    const done = sync.update([record(5)])
    sync.update([])
    put.resolve()
    await done
    await sync.flush()

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'PUT /work-records/5',
      'DELETE /work-records/5',
    ])
  })

  it('keeps syncing other records when one fails, then retries the failed one with backoff', async () => {
    const { sync, calls, request, onError } = setup()
    sync.reset('token-a', [record(1), record(2)])
    request.mockImplementationOnce(async (path, options) => {
      calls.push({ path, ...options })
      throw new Error('network down')
    })

    await sync.update([record(1, { remark: 'x' }), record(2, { remark: 'y' })])
    expect(calls.map((call) => call.path)).toEqual(['/work-records/1', '/work-records/2'])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(sync.hasPendingChanges()).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    await sync.flush()
    expect(calls.map((call) => call.path)).toEqual([
      '/work-records/1',
      '/work-records/2',
      '/work-records/1',
    ])
    expect(sync.hasPendingChanges()).toBe(false)
  })

  it('reports a failure streak once and stops automatic retries after the last delay', async () => {
    const { sync, request, onError } = setup({ retryDelays: [1000] })
    sync.reset('token-a', [])
    request.mockRejectedValue(new Error('server error'))

    await sync.update([record(1)])
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(request).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(request).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(sync.hasPendingChanges()).toBe(true)

    request.mockResolvedValue(undefined)
    await sync.update([record(1)])
    expect(sync.hasPendingChanges()).toBe(false)
  })

  it('flush retries pending changes immediately without waiting for the backoff timer', async () => {
    const { sync, request } = setup({ retryDelays: [60_000] })
    sync.reset('token-a', [])
    request.mockRejectedValueOnce(new Error('offline'))
    await sync.update([record(1)])
    expect(sync.hasPendingChanges()).toBe(true)

    await sync.flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(sync.hasPendingChanges()).toBe(false)
  })

  it('does not sync before a member baseline exists (e.g. right after sign-in)', async () => {
    const { sync, calls } = setup()
    await sync.update([record(1), record(2)])
    expect(calls).toEqual([])
  })

  it('stops after the token changes and ignores late responses for the old account', async () => {
    const { sync, calls, request, state } = setup()
    sync.reset('token-a', [])
    const slow = deferred()
    request.mockImplementationOnce(async (path, options) => {
      calls.push({ path, ...options })
      await slow.promise
    })

    const done = sync.update([record(1), record(2)])
    state.token = null // 請求進行中就登出
    sync.detach()
    slow.resolve()
    await done

    expect(calls.map((call) => call.path)).toEqual(['/work-records/1'])

    state.token = 'token-b'
    sync.reset('token-b', [record(9)])
    await sync.update([record(9)])
    expect(calls).toHaveLength(1)
    expect(sync.hasPendingChanges()).toBe(false)
  })

  it('cancels a pending retry timer on logout', async () => {
    const { sync, request, state } = setup({ retryDelays: [1000] })
    sync.reset('token-a', [])
    request.mockRejectedValueOnce(new Error('offline'))
    await sync.update([record(1)])

    state.token = null
    sync.detach()
    await vi.advanceTimersByTimeAsync(5000)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
