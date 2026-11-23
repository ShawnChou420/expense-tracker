import { describe, expect, it } from 'vitest'
import {
  convertToAudCents,
  formatOriginalAmount,
  normalizeFxRate,
  rateFromAudRates,
  resolveConversion,
  toMinorUnits,
} from './fx.js'

describe('toMinorUnits', () => {
  it('uses the ISO 4217 minor unit (2 for AUD, TWD, USD)', () => {
    expect(toMinorUnits('1500', 'TWD')).toBe(150000)
    expect(toMinorUnits('12.5', 'USD')).toBe(1250)
    expect(toMinorUnits('0.01', 'AUD')).toBe(1)
  })
  it('rejects invalid, zero, negative, too many decimals and unknown currencies', () => {
    for (const value of ['', 'abc', '0', '-5', '1.234', '1e3']) expect(toMinorUnits(value, 'AUD')).toBeNull()
    expect(toMinorUnits('10', 'JPY')).toBeNull()
  })
})

describe('fx conversion', () => {
  it('normalizes rates to at most 10 decimals', () => {
    expect(normalizeFxRate('0.04780')).toBe('0.0478')
    expect(normalizeFxRate(0.1)).toBe('0.1')
    expect(normalizeFxRate('0.00000000001')).toBeNull()
    expect(normalizeFxRate('0')).toBeNull()
    expect(normalizeFxRate('-1')).toBeNull()
  })
  it('rounds half up to whole AUD cents without float drift (same as backend)', () => {
    expect(convertToAudCents(150000, '0.0478')).toBe(7170)
    expect(convertToAudCents(1, '4.5')).toBe(5)
    expect(convertToAudCents(3, '0.1666666667')).toBe(1)
    expect(convertToAudCents(1005, '1.5')).toBe(1508) // 1507.5 → 1508
  })
  it('derives a per-unit rate from the display-currency table (1 AUD = x)', () => {
    expect(rateFromAudRates('AUD', {})).toBe('1')
    expect(rateFromAudRates('TWD', { TWD: 20 })).toBe('0.05')
    expect(rateFromAudRates('USD', {})).toBeNull()
  })
  it('AUD is 1:1; foreign currency without a rate stays unconverted', () => {
    expect(resolveConversion({ amountMinor: 500, currency: 'AUD', fxRate: '2' })).toEqual({
      convertedAudCents: 500,
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
    })
    expect(resolveConversion({ amountMinor: 500, currency: 'TWD' }).convertedAudCents).toBeNull()
    expect(
      resolveConversion({ amountMinor: 1000, currency: 'USD', fxRate: '1.5', fxRateDate: '2026-11-20' }),
    ).toEqual({ convertedAudCents: 1500, fxRate: '1.5', fxRateDate: '2026-11-20', fxSource: 'MANUAL' })
  })
  it('formats the original amount in its own currency', () => {
    expect(formatOriginalAmount(150000, 'TWD')).toBe('NT$1,500')
    expect(formatOriginalAmount(1250, 'USD')).toBe('US$12.50')
    expect(formatOriginalAmount(800, 'AUD')).toBe('$8.00')
  })
})
