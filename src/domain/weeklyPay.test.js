import { describe, expect, it } from 'vitest'
import { getWeeklyPaySummary } from './weeklyPay.js'

const rates = { ppeAllowance: 5, withholdingTaxRate: 0.12 }

describe('getWeeklyPaySummary', () => {
  it('only sums records in the selected Monday-to-Sunday week', () => {
    const records = [
      { workDate: '2026-11-08', grossPay: 999, shiftType: 'normal' }, // previous Sunday
      { workDate: '2026-11-09', grossPay: 200.1, shiftType: 'normal' }, // Monday
      { workDate: '2026-11-15', grossPay: 300.25, shiftType: 'normal' }, // Sunday
      { workDate: '2026-11-16', grossPay: 888, shiftType: 'normal' }, // next Monday
    ]
    const summary = getWeeklyPaySummary(records, '2026-11-11', rates)
    expect(summary.range).toEqual({ start: '2026-11-09', end: '2026-11-15' })
    expect(summary.recordCount).toBe(2)
    expect(summary.shiftCents).toBe(50035)
    expect(summary.ppeCents).toBe(500)
    expect(summary.grossCents).toBe(50535)
    expect(summary.taxCents).toBe(6064)
    expect(summary.netCents).toBe(44471)
  })

  it('adds PPE once per week, not once per shift', () => {
    const records = [
      { workDate: '2026-11-09', grossPay: 100, shiftType: 'normal' },
      { workDate: '2026-11-10', grossPay: 100, shiftType: 'normal' },
      { workDate: '2026-11-11', grossPay: 100, shiftType: 'normal' },
    ]
    expect(getWeeklyPaySummary(records, '2026-11-09', rates).ppeCents).toBe(500)
  })

  it('gives no pay or PPE for a week with only leave', () => {
    const records = [{ workDate: '2026-11-14', grossPay: 0, shiftType: 'leave' }]
    const summary = getWeeklyPaySummary(records, '2026-11-14', rates)
    expect(summary.recordCount).toBe(1)
    expect(summary.grossCents).toBe(0)
    expect(summary.ppeCents).toBe(0)
    expect(summary.netCents).toBe(0)
  })

  it('returns zeros for an empty week instead of NaN', () => {
    const summary = getWeeklyPaySummary([], '2026-11-11', rates)
    expect(summary).toMatchObject({ shiftCents: 0, ppeCents: 0, taxCents: 0, netCents: 0 })
  })

  it('handles a week that spans two months', () => {
    const records = [
      { workDate: '2026-11-30', grossPay: 150, shiftType: 'normal' }, // Monday
      { workDate: '2026-12-06', grossPay: 250, shiftType: 'normal' }, // Sunday
      { workDate: '2026-12-07', grossPay: 999, shiftType: 'normal' },
    ]
    const summary = getWeeklyPaySummary(records, '2026-12-02', { ppeAllowance: 0 })
    expect(summary.range).toEqual({ start: '2026-11-30', end: '2026-12-06' })
    expect(summary.shiftCents).toBe(40000)
    expect(summary.taxCents).toBe(0)
  })

  it('ignores an invalid tax rate', () => {
    const records = [{ workDate: '2026-11-09', grossPay: 100, shiftType: 'normal' }]
    const summary = getWeeklyPaySummary(records, '2026-11-09', { withholdingTaxRate: NaN })
    expect(summary.taxCents).toBe(0)
  })
})
