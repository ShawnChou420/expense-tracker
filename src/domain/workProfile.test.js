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
  getTemplateTimes,
  matchShiftTemplate,
  shiftTimeBy,
  toggleCleaningTimes,
  getRateFlags,
  getSetupCompleteness,
  getSmokoInputs,
  inferLegacyWorkProfile,
  normalizeWorkProfile,
  planFill,
  summarizeFillPreview,
} from './workProfile.js'

const baiada = (/** @type {string} */ preset) =>
  SHIFT_PRESETS.find((item) => item.preset === preset)

function configuredProfile() {
  const night = createShiftTemplate('night', baiada('BAIADA_NIGHT'))
  const early = createShiftTemplate('early', baiada('BAIADA_EARLY'))
  return {
    ...createEmptyWorkProfile(),
    payStatus: PAY_STATUS.PAYSLIP_CONFIRMED,
    scheduleStatus: SCHEDULE_STATUS.CONFIGURED,
    shiftTemplates: [night, early],
    // 週一、三、四、五晚班；週二早班；週六、日休息
    weekPlan: { 0: null, 1: 'night', 2: 'early', 3: 'night', 4: 'night', 5: 'night', 6: null },
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
    expect(inferLegacyWorkProfile({ baseRate: '26.7400' }).payStatus).toBe(
      PAY_STATUS.NOT_CONFIGURED,
    )
    expect(inferLegacyWorkProfile(null).payStatus).toBe(PAY_STATUS.NOT_CONFIGURED)
  })
})

describe('shift templates', () => {
  it('provides the Baiada reference times only as suggestions', () => {
    expect(SHIFT_PRESETS.map((item) => `${item.name} ${item.startTime}-${item.endTime}`)).toEqual([
      '早班 06:00-15:00',
      '中班 15:00-23:50',
      '晚班 23:50-06:00',
    ])
    expect(
      SHIFT_PRESETS.map((item) => `${item.name} ${item.cleaningStartTime}-${item.cleaningEndTime}`),
    ).toEqual(['早班 06:00-12:15', '中班 12:00-17:45', '晚班 17:45-00:00'])
    expect(crossesMidnight(baiada('BAIADA_EARLY'))).toBe(false)
    expect(crossesMidnight(baiada('BAIADA_NIGHT'))).toBe(true)
  })

  it('follows the weekly plan and never marks a weekday as a cleaning day by itself', () => {
    const profile = configuredProfile()
    expect(getPlannedShift(profile, '2026-11-09')).toMatchObject({
      startTime: '23:50',
      endTime: '06:00',
      isCleaningDay: false,
    })
    expect(getPlannedShift(profile, '2026-11-10')).toMatchObject({
      name: '早班',
      startTime: '06:00',
      isCleaningDay: false,
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
    const profile = {
      ...createEmptyWorkProfile(),
      confirmedRateKeys: ['baseRate', 'casualLoadingRate'],
    }
    const { rates, status } = getEffectiveRates(values, profile)
    expect(rates.casualLoadingRate).toBe(7.0025)
    expect(status.saturdayOrdLoadingRate).toBe('EXCLUDED')
    expect(rates.saturdayOrdLoadingRate).toBe(0)
    const flags = getRateFlags({ ordinaryHours: 8, satOrdHours: 3 }, status)
    expect(flags.excluded).toEqual(['週六加給'])
  })

  it('keeps the confirmed base rate for unconfirmed overtime instead of paying 0', () => {
    const profile = { ...createEmptyWorkProfile(), confirmedRateKeys: ['baseRate'] }
    const { rates, status } = getEffectiveRates({ baseRate: 30 }, profile)
    expect(rates.timeHalfRate).toBe(30)
    expect(rates.doubleRate).toBe(30)
    expect(status.timeHalfRate).toBe('EXCLUDED')
    expect(getRateFlags({ timeHalfHours: 6 }, status).excluded).toEqual(['加班 1.5 倍加成'])
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
      {
        shiftType: 'normal',
        paidMinutes: 360,
        grossPay: 210.5,
        rateFlags: { provisional: ['夜班加給'] },
      },
      {
        shiftType: 'normal',
        paidMinutes: 345,
        grossPay: 200.25,
        rateFlags: { excluded: ['週日加給'] },
      },
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
      '早班 06:00–15:00 · 週二',
    ])
    expect(describeSmoko({ mode: 'FIXED', count: 1, minutes: 20, paid: true })).toBe(
      '每班固定 1 次 · 每次 20 分鐘 · 照常計薪',
    )
  })
})

describe('當天快速調整', () => {
  const templates = SHIFT_PRESETS.map((preset, index) => createShiftTemplate(`t${index}`, preset))
  const [early, middle, night] = templates

  it('提早／延後時間，跨午夜自動繞回', () => {
    expect(shiftTimeBy('06:00', -15)).toBe('05:45')
    expect(shiftTimeBy('23:50', 15)).toBe('00:05')
    expect(shiftTimeBy('00:05', -10)).toBe('23:55')
    expect(shiftTimeBy('', 5)).toBe('')
  })

  it('清潔日用班別自己的清潔時間，沒設就沿用一般時間', () => {
    expect(getTemplateTimes(middle, true)).toEqual({ startTime: '12:00', endTime: '17:45' })
    const custom = createShiftTemplate('c', { name: '自訂', startTime: '08:00', endTime: '16:00' })
    expect(getTemplateTimes(custom, true)).toEqual({ startTime: '08:00', endTime: '16:00' })
  })

  it('主管調整過的時間仍認得是哪個班別', () => {
    expect(matchShiftTemplate(templates, '23:30', false)).toBe(night) // 晚班提早 20 分
    expect(matchShiftTemplate(templates, '00:10', false)).toBe(night) // 跨午夜延後
    expect(matchShiftTemplate(templates, '06:20', false)).toBe(early)
    expect(matchShiftTemplate(templates, '17:45', true)).toBe(night) // 清潔日晚班
    expect(matchShiftTemplate(templates, '10:00', false)).toBeNull()
  })

  it('打開清潔日只換這一天的時間，關掉換回一般時間', () => {
    expect(
      toggleCleaningTimes(templates, { startTime: '23:50', endTime: '06:00' }, true),
    ).toMatchObject({
      startTime: '17:45',
      endTime: '00:00',
      template: night,
    })
    expect(
      toggleCleaningTimes(templates, { startTime: '12:00', endTime: '17:45' }, false),
    ).toMatchObject({
      startTime: '15:00',
      endTime: '23:50',
      template: middle,
    })
    // 認不出的自訂時間：保留原本時間
    expect(
      toggleCleaningTimes(templates, { startTime: '10:00', endTime: '14:00' }, true),
    ).toMatchObject({
      startTime: '10:00',
      endTime: '14:00',
      template: null,
    })
  })

  it('舊資料的「清潔班」開關不再讓整週變清潔班，清潔時間要成對才保留', () => {
    const profile = normalizeWorkProfile({
      scheduleStatus: 'CONFIGURED',
      shiftTemplates: [
        { id: 'a', name: '晚班清潔班', startTime: '17:45', endTime: '00:00', isCleaning: true },
        { id: 'b', name: '早班', startTime: '06:00', endTime: '15:00', cleaningStartTime: '06:00' },
      ],
      weekPlan: { 2: 'a' },
    })
    expect(profile.shiftTemplates[0]).not.toHaveProperty('isCleaning')
    expect(profile.shiftTemplates[1]).toMatchObject({
      cleaningStartTime: null,
      cleaningEndTime: null,
    })
    expect(getPlannedShift(profile, '2026-11-10')).toMatchObject({ isCleaningDay: false })
  })
})
