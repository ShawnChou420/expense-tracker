import { describe, expect, it } from 'vitest'
import { formatCalendarAmount } from '../src/utils/calendarMoney.js'

describe('calendar amount display', () => {
  it('rounds only the compact calendar label, not pay calculations', () => {
    expect(formatCalendarAmount(233.98)).toBe('234')
    expect(formatCalendarAmount(9999)).toBe('9999')
    expect(formatCalendarAmount(12345)).toBe('12.3K')
    expect(formatCalendarAmount(1_234_567)).toBe('1.2M')
  })

  it('never shows NaN for an unavailable amount', () => {
    expect(formatCalendarAmount(undefined)).toBe('0')
  })
})
