import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REQUEST_TIMEOUT_MS,
  SLOW_REQUEST_MS,
  apiRequest,
  authToken,
  clearSession,
  getAuthConfig,
  restoreSavedSession,
  serverSlow,
  sessionExpired,
  waitForBackendReady,
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

describe('waitForBackendReady', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps asking while the backend is still starting, then resolves once ready', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' })
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetch)
    expect(await waitForBackendReady({ intervalMs: 1 })).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[0][0]).toMatch(/\/ready$/)
  })

  it('stops waiting on an unrelated error such as an older backend without /ready', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    vi.stubGlobal('fetch', fetch)
    expect(await waitForBackendReady({ intervalMs: 1 })).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not keep an offline user waiting', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetch)
    expect(await waitForBackendReady({ intervalMs: 1, maxNetworkErrors: 3 })).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('restoreSavedSession', () => {
  /** @type {Map<string, string>} */
  let store
  beforeEach(() => {
    store = new Map([['expense-tracker.session', JSON.stringify({ token: 'old-token', email: 'a@example.com' })]])
    vi.stubGlobal('localStorage', {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    })
    clearSession()
    sessionExpired.value = false
  })
  afterEach(() => vi.unstubAllGlobals())

  it('only marks the user signed in after the backend accepts the saved token', async () => {
    const pending = deferredFetch()
    const fetch = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetch)
    const restoring = restoreSavedSession()
    expect(authToken.value).toBeNull()
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer old-token')
    pending.resolve(json({ email: 'a@example.com', roles: [] }))
    expect(await restoring).toBe(true)
    expect(authToken.value).toBe('old-token')
  })

  it('quietly forgets a rejected token and flags it once for the screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 401)),
    )
    expect(await restoreSavedSession()).toBe(false)
    expect(authToken.value).toBeNull()
    expect(store.has('expense-tracker.session')).toBe(false)
    expect(sessionExpired.value).toBe(true)
  })

  it('keeps the saved login when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await restoreSavedSession()).toBe(false)
    expect(store.has('expense-tracker.session')).toBe(true)
    expect(sessionExpired.value).toBe(false)
  })
})

describe('401 handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('does not show a raw 401 for a request that was sent with an older token', async () => {
    authToken.value = 'stale'
    const pending = deferredFetch()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    )
    const request = apiRequest('/expenses')
    authToken.value = 'fresh'
    pending.resolve(json({}, 401))
    await expect(request).rejects.toMatchObject({ code: 'SESSION_EXPIRED', message: '登入已失效，請重新登入' })
    // 新的登入不受舊請求影響
    expect(authToken.value).toBe('fresh')
  })
})
