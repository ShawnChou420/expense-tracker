import { describe, expect, it } from 'vitest'
import {
  buildFuelQueryPath,
  describeFuelFreshness,
  formatFuelPrice,
  getCheapestGap,
  isValidPostcode,
  normalizeFuelPrefs,
} from './fuel.js'

describe('fuel prefs', () => {
  it('falls back to E10 + postcode mode and drops invalid values', () => {
    expect(normalizeFuelPrefs(null)).toEqual({ fuelType: 'E10', mode: 'POSTCODE', postcode: '' })
    expect(normalizeFuelPrefs({ fuelType: 'WATER', mode: 'X', postcode: '20' })).toEqual({
      fuelType: 'E10',
      mode: 'POSTCODE',
      postcode: '',
    })
    expect(normalizeFuelPrefs({ fuelType: 'U91', mode: 'GPS', postcode: '2150' })).toEqual({
      fuelType: 'U91',
      mode: 'GPS',
      postcode: '2150',
    })
  })

  it('accepts only 4-digit postcodes', () => {
    expect(isValidPostcode('2000')).toBe(true)
    expect(isValidPostcode('200')).toBe(false)
    expect(isValidPostcode(2000)).toBe(false)
  })
})

describe('buildFuelQueryPath', () => {
  it('prefers coordinates rounded to 3 decimals', () => {
    expect(
      buildFuelQueryPath({ fuelType: 'E10', latitude: -33.868812, longitude: 151.209295 }),
    ).toBe('/fuel-prices/nearby?fuelType=E10&lat=-33.869&lng=151.209&limit=3')
  })

  it('uses postcode otherwise, and returns null without a location', () => {
    expect(buildFuelQueryPath({ fuelType: 'DL', postcode: '2150' })).toBe(
      '/fuel-prices/nearby?fuelType=DL&postcode=2150&limit=3',
    )
    expect(buildFuelQueryPath({ fuelType: 'E10', postcode: '' })).toBeNull()
    expect(buildFuelQueryPath({ fuelType: 'BAD', postcode: '2000' })).toContain('fuelType=E10')
  })
})

describe('fuel display', () => {
  it('formats tenths of a cent per litre', () => {
    expect(formatFuelPrice(1899)).toBe('189.9')
    expect(formatFuelPrice(2000)).toBe('200.0')
    expect(formatFuelPrice(0)).toBe('—')
  })

  it('shows the gap to the second cheapest', () => {
    expect(getCheapestGap([{ priceTenths: 1799 }, { priceTenths: 1859 }])).toBe('6.0')
    expect(getCheapestGap([{ priceTenths: 1799 }, { priceTenths: 1799 }])).toBeNull()
    expect(getCheapestGap([{ priceTenths: 1799 }])).toBeNull()
  })

  it('describes freshness', () => {
    const now = new Date('2026-11-21T10:00:00Z')
    expect(describeFuelFreshness('2026-11-21T09:59:40Z', now)).toBe('剛剛更新')
    expect(describeFuelFreshness('2026-11-21T09:48:00Z', now)).toBe('12 分鐘前更新')
    expect(describeFuelFreshness('2026-11-21T08:00:00Z', now)).toBe('2 小時前更新')
    expect(describeFuelFreshness(null, now)).toBe('')
  })
})
