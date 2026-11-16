import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REQUEST_TIMEOUT_MS,
  SLOW_REQUEST_MS,
  apiRequest,
  getAuthConfig,
  serverSlow,
  wakeServer,
} from '../src/services/authSession.js'

/** 回傳一個可以手動完成的 fetch 回應 */
function deferredFetch() {
  /** @type {(value: any) => void} */
  let resolve = () => {}
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
})

describe('apiRequest', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shares one network call between identical concurrent GETs, giving each caller its own copy', async () => {
    const pending = deferredFetch()
    const fetch = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetch)
    const first = apiRequest('/dashboard-settings')
    const second = apiRequest('/dashboard-settings')
    pending.resolve(json({ savingGoal: { name: 'Trip' } }))
    const [a, b] = await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    a.savingGoal.name = 'changed'
    expect(b.savingGoal.name).toBe('Trip')
  })

  it('never merges writes, and fetches again once the earlier GET finished', async () => {
    const fetch = vi.fn(async () => json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([
      apiRequest('/expenses/a', { method: 'PUT', body: {} }),
      apiRequest('/expenses/a', { method: 'PUT', body: {} }),
    ])
    await apiRequest('/expenses')
    await apiRequest('/expenses')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('flags a slow server while a request is pending and clears it afterwards', async () => {
    const pending = deferredFetch()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    )
    const request = apiRequest('/auth/me')
    expect(serverSlow.value).toBe(false)
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS)
    expect(serverSlow.value).toBe(true)
    pending.resolve(json({ email: 'a@example.com' }))
    await request
    expect(serverSlow.value).toBe(false)
  })

  it('gives up after the timeout with a TIMEOUT error instead of hanging forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ),
    )
    const request = apiRequest('/auth/login', { method: 'POST', body: {} })
    const assertion = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    await assertion
    expect(serverSlow.value).toBe(false)
  })

  it('reports unknown auth config as null instead of guessing that no code is needed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await getAuthConfig()).toBeNull()
  })

  it('wakes the server once per app start without blocking or retrying', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('cold')
    })
    vi.stubGlobal('fetch', fetch)
    wakeServer()
    wakeServer()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/health$/)
    expect(serverSlow.value).toBe(false)
  })

  it('reads the wake-up response so the request actually finishes', async () => {
    vi.resetModules()
    const { wakeServer: freshWake } = await import('../src/services/authSession.js')
    const text = vi.fn(async () => '{"status":"ok"}')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ text })),
    )
    freshWake()
    await vi.waitFor(() => expect(text).toHaveBeenCalledTimes(1))
  })
})
