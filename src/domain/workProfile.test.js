import { describe, expect, it } from 'vitest'
import {
  PAY_STATUS,
  SCHEDULE_STATUS,
  SHIFT_PRESETS,
  createEmptyWorkProfile,
  createShiftTemplate,
  crossesMidnight,
  describeSmoko,
  describeWeekPlan,
  getEffectiveRates,
  getPlannedShift,
  getRateFlags,
  getSetupCompleteness,
  getSmokoInputs,
  inferLegacyWorkProfile,
  normalizeWorkProfile,
  planFill,
  summarizeFillPreview,
} from './workProfile.js'

const baiada = (/** @type {string} */ preset) => SHIFT_PRESETS.find((item) => item.preset === preset)

function configuredProfile() {
  const night = createShiftTemplate('night', baiada('BAIADA_NIGHT'))
  const cleaning = createShiftTemplate('clean', baiada('BAIADA_CLEANING'))
  return {
    ...createEmptyWorkProfile(),
    payStatus: PAY_STATUS.PAYSLIP_CONFIRMED,
    scheduleStatus: SCHEDULE_STATUS.CONFIGURED,
    shiftTemplates: [night, cleaning],
    // 週一、三、四、五晚班；週二清潔班；週六、日休息
    weekPlan: { 0: null, 1: 'night', 2: 'clean', 3: 'night', 4: 'night', 5: 'night', 6: null },
  }
}

describe('setup completeness', () => {
  it('a new guest has nothing configured and no developer defaults', () => {
    const profile = createEmptyWorkProfile()
    expect(profile.shiftTemplates).toEqual([])
    expect(profile.weekPlan).toEqual({})
    const result = getSetupCompleteness(profile, { baseRate: 0 })
    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['薪資費率', '預設上下班時間', '每週工作日'])
  })

  it('payslip rates without shifts are not ready for auto scheduling', () => {
    const profile = { ...createEmptyWorkProfile(), payStatus: PAY_STATUS.PAYSLIP_CONFIRMED }
    const result = getSetupCompleteness(profile, { baseRate: 28.01 })
    expect(result).toMatchObject({ payReady: true, scheduleReady: false, ready: false })
  })

  it('needs the smoko step to be saved before scheduling is ready', () => {
    const profile = { ...configuredProfile(), scheduleStatus: SCHEDULE_STATUS.NOT_CONFIGURED }
    expect(getSetupCompleteness(profile, { baseRate: 28.01 }).missing).toEqual(['Smoko 規則'])
  })

  it('is ready once pay and schedule are confirmed', () => {
    expect(getSetupCompleteness(configuredProfile(), { baseRate: 28.01 }).ready).toBe(true)
  })
})

describe('legacy members', () => {
  it('keeps members who saved their own rates as configured and preserves their estimates', () => {
    const profile = inferLegacyWorkProfile({ baseRate: '28.0100', withholdingTaxRate: '0.15' })
    expect(profile.payStatus).toBe(PAY_STATUS.MANUAL_CONFIRMED)
    expect(profile.allowProvisionalRates).toBe(true)
    expect(profile.scheduleStatus).toBe(SCHEDULE_STATUS.NOT_CONFIGURED)
  })

  it('treats the old developer test rate as not configured', () => {
    expect(inferLegacyWorkProfile({ baseRate: '26.7400' }).payStatus).toBe(PAY_STATUS.NOT_CONFIGURED)
    expect(inferLegacyWorkProfile(null).payStatus).toBe(PAY_STATUS.NOT_CONFIGURED)
  })
})

describe('shift templates', () => {
  it('provides the Baiada reference times only as suggestions', () => {
    expect(SHIFT_PRESETS.map((item) => `${item.name} ${item.startTime}-${item.endTime}`)).toEqual([
      '早班 06:00-15:00',
      '中班 15:00-23:50',
      '晚班 23:50-06:00',
      '晚班清潔班 17:45-00:00',
    ])
    expect(crossesMidnight(baiada('BAIADA_EARLY'))).toBe(false)
    expect(crossesMidnight(baiada('BAIADA_NIGHT'))).toBe(true)
    expect(crossesMidnight(baiada('BAIADA_CLEANING'))).toBe(true)
  })

  it('follows the weekly plan, including a cleaning shift on the chosen weekday', () => {
    const profile = configuredProfile()
    expect(getPlannedShift(profile, '2026-11-09')).toMatchObject({
      startTime: '23:50',
      endTime: '06:00',
      isCleaningDay: false,
    })
    expect(getPlannedShift(profile, '2026-11-10')).toMatchObject({
      name: '晚班清潔班',
      isCleaningDay: true,
    })
    expect(getPlannedShift(profile, '2026-11-14')).toBeNull()
  })

  it('creates leave records on off days only when the user chose that rule', () => {
    const profile = { ...configuredProfile(), offDayRule: 'LEAVE' }
    expect(getPlannedShift(profile, '2026-11-15')).toMatchObject({ shiftType: 'leave' })
  })
})

describe('planFill', () => {
  it('never overwrites existing shifts or leave and skips off days', () => {
    const records = [{ workDate: '2026-11-09' }, { workDate: '2026-11-11' }]
    const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14']
    const result = planFill(records, configuredProfile(), dates)
    expect(result.plan.map((item) => item.date)).toEqual(['2026-11-10', '2026-11-12'])
    expect(result.skippedExisting).toBe(2)
    expect(result.offDays).toBe(1)
  })

  it('supports custom weekdays instead of assuming a six-day week', () => {
    const profile = {
      ...configuredProfile(),
      weekPlan: { 0: null, 1: 'night', 2: null, 3: null, 4: null, 5: 'night', 6: null },
    }
    const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
    expect(planFill([], profile, dates).plan.map((item) => item.date)).toEqual([
      '2026-11-09',
      '2026-11-13',
    ])
  })
})

describe('smoko', () => {
  it('uses the existing automatic rule unless the user fixed a count', () => {
    expect(getSmokoInputs({ mode: 'AUTO', count: 2, minutes: 30, paid: false })).toEqual({
      smokoCountOverride: null,
      deductMinutesPerBreak: 30,
    })
    expect(getSmokoInputs({ mode: 'FIXED', count: 0, minutes: 30, paid: false })).toEqual({
      smokoCountOverride: 0,
      deductMinutesPerBreak: 30,
    })
  })

  it('does not deduct paid smoko breaks', () => {
    expect(getSmokoInputs({ mode: 'FIXED', count: 2, minutes: 15, paid: true })).toEqual({
      smokoCountOverride: 2,
      deductMinutesPerBreak: 0,
    })
  })
})

describe('unconfirmed rates', () => {
  const values = {
    baseRate: 28.01,
    casualLoadingRate: 7.0025,
    shiftLoadingRate: 7.0025,
    saturdayOrdLoadingRate: 14.005,
    sundayLoadingRate: 21.0075,
    timeHalfRate: 42.015,
    doubleRate: 56.02,
  }

  it('does not silently apply unconfirmed rates', () => {
    const profile = { ...createEmptyWorkProfile(), confirmedRateKeys: ['baseRate', 'casualLoadingRate'] }
    const { rates, status } = getEffectiveRates(values, profile)
    expect(rates.casualLoadingRate).toBe(7.0025)
    expect(status.saturdayOrdLoadingRate).toBe('EXCLUDED')
    expect(rates.saturdayOrdLoadingRate).toBe(0)
    const flags = getRateFlags({ ordinaryHours: 8, satOrdHours: 3 }, status)
    expect(flags.excluded).toEqual(['週六加給'])
  })

  it('uses default multipliers only after the user accepts provisional rates', () => {
    const profile = {
      ...createEmptyWorkProfile(),
      confirmedRateKeys: ['baseRate'],
      allowProvisionalRates: true,
    }
    const { rates, status } = getEffectiveRates({ baseRate: 30 }, profile)
    expect(rates.sundayLoadingRate).toBe(22.5)
    expect(status.sundayLoadingRate).toBe('PROVISIONAL')
    expect(getRateFlags({ sunOrdHours: 6, holidayHours: 0 }, status).provisional).toEqual([
      '週日加給',
    ])
  })
})

describe('normalizeWorkProfile', () => {
  it('drops invalid data and keeps valid templates and plan', () => {
    const profile = normalizeWorkProfile({
      payStatus: 'HACKED',
      shiftTemplates: [
        { id: 'a', name: '早班', startTime: '06:00', endTime: '15:00' },
        { id: 'b', startTime: '25:00', endTime: '15:00' },
      ],
      weekPlan: { 1: 'a', 2: 'b' },
      scheduleStatus: 'CONFIGURED',
      smoko: { mode: 'FIXED', count: 9, minutes: 999, paid: true },
    })
    expect(profile.payStatus).toBe(PAY_STATUS.NOT_CONFIGURED)
    expect(profile.shiftTemplates.map((item) => item.id)).toEqual(['a'])
    expect(profile.weekPlan[1]).toBe('a')
    expect(profile.weekPlan[2]).toBeNull()
    expect(profile.smoko).toEqual({ mode: 'FIXED', count: 3, minutes: 60, paid: true })
  })
})

describe('fill preview summary', () => {
  it('counts shifts, leave, hours, gross and unconfirmed rates', () => {
    const summary = summarizeFillPreview([
      { shiftType: 'normal', paidMinutes: 360, grossPay: 210.5, rateFlags: { provisional: ['夜班加給'] } },
      { shiftType: 'normal', paidMinutes: 345, grossPay: 200.25, rateFlags: { excluded: ['週日加給'] } },
      { shiftType: 'leave', paidMinutes: 0, grossPay: 0 },
    ])
    expect(summary).toEqual({
      shiftCount: 2,
      leaveCount: 1,
      paidMinutes: 705,
      grossCents: 41075,
      rateFlags: { provisional: ['夜班加給'], excluded: ['週日加給'] },
    })
  })

  it('describes the week plan and smoko rule in plain words', () => {
    expect(describeWeekPlan(configuredProfile())).toEqual([
      '晚班 23:50–06:00（隔天） · 週一三四五',
      '晚班清潔班 17:45–00:00（隔天） · 週二',
    ])
    expect(describeSmoko({ mode: 'FIXED', count: 1, minutes: 20, paid: true })).toBe(
      '每班固定 1 次 · 每次 20 分鐘 · 照常計薪',
    )
  })
})
