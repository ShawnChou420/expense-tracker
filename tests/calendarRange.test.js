import { describe, expect, it } from 'vitest'
import { formatLocalDate, getCalendarDateRange } from '../src/domain/date.js'

const range = (options) => {
  const { minDate, maxDate } = getCalendarDateRange(options)
  return { min: formatLocalDate(minDate), max: formatLocalDate(maxDate) }
}

describe('getCalendarDateRange', () => {
  it('rolls the end year forward with today instead of stopping at 2027-12-31', () => {
    expect(range({ today: new Date(2026, 10, 10) })).toEqual({
      min: '2025-01-01',
      max: '2028-12-31',
    })
    expect(range({ today: new Date(2027, 11, 31) })).toEqual({
      min: '2025-01-01',
      max: '2029-12-31',
    })
  })

  it('lets a date across the new year be selected', () => {
    const { minDate, maxDate } = getCalendarDateRange({ today: new Date(2027, 11, 20) })
    const nextYear = new Date(2028, 0, 3)
    expect(nextYear >= minDate && nextYear <= maxDate).toBe(true)
  })

  it('covers a selected date or imported record far outside the default window', () => {
    expect(
      range({ today: new Date(2026, 10, 10), dates: ['2031-02-14', '2024-03-01', null, 'bad'] }),
    ).toEqual({ min: '2024-01-01', max: '2031-12-31' })
  })

  it('returns local dates (not UTC-shifted) at the year boundaries', () => {
    const { minDate, maxDate } = getCalendarDateRange({ today: new Date(2026, 0, 1) })
    expect([minDate.getMonth(), minDate.getDate()]).toEqual([0, 1])
    expect([maxDate.getMonth(), maxDate.getDate()]).toEqual([11, 31])
  })
})
