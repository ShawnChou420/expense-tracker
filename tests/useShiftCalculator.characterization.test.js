import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useShiftCalculator } from '../src/composables/useShiftCalculator.js'

function calculate({ date, start, end, smokoCountOverride = null }) {
  const baseRate = ref(26.74)
  return useShiftCalculator({
    workDate: ref(date),
    startTime: ref(start),
    endTime: ref(end),
    smokoMinutesPerBreak: ref(30),
    smokoCountOverride: ref(smokoCountOverride),
    baseRate,
    casualLoadingRate: computed(() => baseRate.value * 0.25),
    shiftLoadingRate: computed(() => baseRate.value * 0.25),
    saturdayOrdLoadingRate: computed(() => baseRate.value * 0.5),
    sundayLoadingRate: computed(() => baseRate.value * 0.75),
    timeHalfRate: computed(() => baseRate.value * 1.5),
    doubleRate: computed(() => baseRate.value * 2),
  })
}

describe('useShiftCalculator characterization', () => {
  it('splits a cross-midnight Friday shift into Friday and Saturday before rates', () => {
    const result = calculate({ date: '2026-04-10', start: '23:45', end: '06:00' })
    expect(result.workSummary.value).toMatchObject({
      totalMinutes: 375,
      smokoCount: 1,
      paidMinutes: 345,
      crossesMidnight: true,
    })
    expect(result.paidSegmentedMinutes.value).toEqual({
      weekdayPaidMinutes: 15,
      saturdayPaidMinutes: 330,
      sundayPaidMinutes: 0,
      holidayPaidMinutes: 0,
    })
    expect(result.saturdayRuleBreakdown.value).toEqual({
      satOrdMinutes: 0,
      timeHalfMinutes: 180,
      doubleMinutes: 150,
    })
  })

  it('deducts the configured smoko window from paid minutes', () => {
    const result = calculate({ date: '2026-04-06', start: '08:00', end: '12:00' })
    expect(result.workSummary.value).toMatchObject({
      totalMinutes: 240,
      smokoCount: 1,
      smokoDeductMinutes: 30,
      paidMinutes: 210,
    })
  })

  it('applies weekday night shift loading to a cross-midnight weekday shift', () => {
    const result = calculate({ date: '2026-04-06', start: '23:45', end: '06:00' })
    expect(result.isNightShift.value).toBe(true)
    expect(result.payBreakdown.value.shiftPay).toBeGreaterThan(0)
    expect(result.paidSegmentedMinutes.value.weekdayPaidMinutes).toBe(345)
  })

  it('keeps the existing Saturday time-and-a-half and double segmentation', () => {
    const result = calculate({ date: '2026-04-11', start: '08:00', end: '12:00' })
    expect(result.paidSegmentedMinutes.value.saturdayPaidMinutes).toBe(210)
    expect(result.saturdayRuleBreakdown.value).toEqual({
      satOrdMinutes: 0,
      timeHalfMinutes: 180,
      doubleMinutes: 30,
    })
  })

  it('keeps Sunday loading separate from night loading', () => {
    const result = calculate({ date: '2026-04-12', start: '08:00', end: '12:00' })
    expect(result.paidSegmentedMinutes.value.sundayPaidMinutes).toBe(210)
    expect(result.payBreakdown.value.sunOrdPay).toBeGreaterThan(0)
    expect(result.payBreakdown.value.shiftPay).toBe(0)
  })

  it('recognises Good Friday public-holiday minutes and the existing 150 percent penalty', () => {
    const result = calculate({ date: '2026-04-03', start: '08:00', end: '12:00' })
    expect(result.holidaySummary.value).toEqual({ holidayMinutes: 240, holidayPaidMinutes: 210 })
    expect(result.payBreakdown.value.holidayPenaltyRate).toBe(40.11)
    expect(result.payBreakdown.value.holidayPenaltyPay).toBe(140.39)
  })
})
