import { describe, expect, it } from 'vitest'
import { formatCentsIn, resolveDisplayCurrency } from './displayCurrency.js'

const rates = { AUD: 1, TWD: 21.3, USD: 0.66, KRW: 905.5 }

describe('display currency', () => {
  it('keeps AUD formatting unchanged', () => {
    const aud = resolveDisplayCurrency('AUD', rates)
    expect(formatCentsIn(123456, aud)).toBe('$1,234.56')
    expect(formatCentsIn(-1200, aud)).toBe('-$12.00')
  })

  it('converts AUD cents with the exchange rate and the currency’s usual decimals', () => {
    expect(formatCentsIn(100000, resolveDisplayCurrency('TWD', rates))).toBe('NT$21,300')
    expect(formatCentsIn(100000, resolveDisplayCurrency('USD', rates))).toBe('US$660.00')
    expect(formatCentsIn(-5000, resolveDisplayCurrency('KRW', rates))).toBe('-₩45,275')
    expect(formatCentsIn(0, resolveDisplayCurrency('TWD', rates))).toBe('NT$0')
  })

  it('falls back to AUD when the exchange rate is not available', () => {
    const currency = resolveDisplayCurrency('TWD', { AUD: 1 })
    expect(currency).toMatchObject({ code: 'AUD', fallback: true, requested: 'TWD' })
    expect(formatCentsIn(100000, currency)).toBe('$1,000.00')
  })
})
