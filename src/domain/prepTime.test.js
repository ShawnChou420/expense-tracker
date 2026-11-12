import { describe, expect, it } from 'vitest'
import { applyPrepTime, PREP_MINUTES } from './prepTime.js'

describe('applyPrepTime', () => {
  it('moves the paid start earlier by the prep minutes', () => {
    expect(applyPrepTime('2026-11-11', '23:50', PREP_MINUTES)).toEqual({
      workDate: '2026-11-11',
      startTime: '23:45',
    })
  })

  it('borrows from the previous hour', () => {
    expect(applyPrepTime('2026-11-11', '17:02', 5)).toEqual({
      workDate: '2026-11-11',
      startTime: '16:57',
    })
  })

  it('moves to the previous day when the start crosses midnight', () => {
    expect(applyPrepTime('2026-11-01', '00:03', 5)).toEqual({
      workDate: '2026-10-31',
      startTime: '23:58',
    })
  })

  it('keeps the original start when prep is off', () => {
    expect(applyPrepTime('2026-11-11', '23:50', 0)).toEqual({
      workDate: '2026-11-11',
      startTime: '23:50',
    })
  })

  it('returns null for an invalid date or time', () => {
    expect(applyPrepTime('2026-02-30', '23:50', 5)).toBeNull()
    expect(applyPrepTime('2026-11-11', '24:00', 5)).toBeNull()
    expect(applyPrepTime('2026-11-11', '2:50', 5)).toBeNull()
  })
})
