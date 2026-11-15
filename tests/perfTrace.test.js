import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizePath,
  parseServerTiming,
  recordRequest,
  setPerfTraceEnabled,
  startPerfPhase,
  summarizeDurations,
  summarizeRequests,
} from '../src/services/perfTrace.js'

afterEach(() => setPerfTraceEnabled(false))

describe('parseServerTiming', () => {
  it('reads app, db, conn durations and query count', () => {
    expect(parseServerTiming('app;dur=12.3, db;dur=4.5;desc="2 queries", conn;dur=0.1')).toEqual({
      app: 12.3,
      db: 4.5,
      queries: 2,
      conn: 0.1,
    })
  })

  it('returns empty object when header is missing or malformed', () => {
    expect(parseServerTiming(null)).toEqual({})
    expect(parseServerTiming('garbage')).toEqual({})
  })
})

describe('normalizePath', () => {
  it('groups record ids, dates and uuids and drops query strings', () => {
    expect(normalizePath('/expenses/expense-1700000000-abc/payments')).toBe(
      '/expenses/:id/payments',
    )
    expect(normalizePath('/leave-blackouts/2026-11-16')).toBe('/leave-blackouts/:date')
    expect(normalizePath('/payslip-imports/3f2a1b4c-1111-2222-3333-444455556666')).toBe(
      '/payslip-imports/:id',
    )
    expect(normalizePath('/work-records?from=2026-11-01')).toBe('/work-records')
  })
})

describe('summarizeDurations', () => {
  it('uses nearest-rank percentiles', () => {
    expect(summarizeDurations([30, 10, 20])).toEqual({
      count: 3,
      min: 10,
      p50: 20,
      p95: 30,
      max: 30,
    })
  })

  it('handles empty samples without inventing numbers', () => {
    expect(summarizeDurations([])).toEqual({
      count: 0,
      min: null,
      p50: null,
      p95: null,
      max: null,
    })
  })
})

describe('request recording', () => {
  it('records nothing while disabled', () => {
    recordRequest({ method: 'GET', path: '/disabled-only', status: 200, ms: 5, server: {} })
    expect(summarizeRequests().some((row) => row.request === 'GET /disabled-only')).toBe(false)
  })

  it('reports request count and duplicates for a phase', () => {
    setPerfTraceEnabled(true)
    const info = vi.spyOn(globalThis.console, 'info').mockImplementation(() => {})
    const end = startPerfPhase('登入後載入資料')
    recordRequest({
      method: 'GET',
      path: '/salary-rates',
      status: 200,
      ms: 100,
      server: { app: 40 },
    })
    recordRequest({
      method: 'GET',
      path: '/salary-rates',
      status: 200,
      ms: 120,
      server: { app: 60 },
    })
    recordRequest({ method: 'GET', path: '/work-records', status: 500, ms: 80, server: {} })
    end()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('3 個請求'), {
      重複: ['GET /salary-rates ×2'],
    })
    const rates = summarizeRequests().find((row) => row.request === 'GET /salary-rates')
    expect(rates).toMatchObject({ count: 2, failed: 0, p50ms: 100, p95ms: 120, serverP50ms: 40 })
    expect(summarizeRequests().find((row) => row.request === 'GET /work-records')?.failed).toBe(1)
    info.mockRestore()
  })
})
