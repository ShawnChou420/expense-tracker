import { describe, expect, it } from 'vitest'
import {
  addDays,
  describeStart,
  formatDuration,
  getEarnedSoFar,
  getFocusShift,
  getGreeting,
  getTaskProgress,
  occursOn,
  toShift,
} from './today.js'

const night = {
  workDate: '2026-11-18',
  startTime: '23:50',
  endTime: '06:00',
  paidMinutes: 340,
  totalMinutes: 370,
  smokoCount: 1,
  smokoDeductMinutes: 30,
  grossPay: 212.5,
  shiftType: 'normal',
}
const day = (workDate, startTime = '07:00', endTime = '15:30') => ({
  workDate,
  startTime,
  endTime,
  paidMinutes: 480,
  grossPay: 250,
  shiftType: 'normal',
})

describe('getFocusShift', () => {
  it('凌晨 02:00 仍顯示前一天開始的夜班「正在上班」', () => {
    const focus = getFocusShift([night], new Date(2026, 10, 19, 2, 0))
    expect(focus.kind).toBe('current')
    expect(focus.shift?.workDate).toBe('2026-11-18')
    expect(focus.shift?.crossesMidnight).toBe(true)
  })

  it('跨午夜不會變成負數工時，金額沿用班表已算好的稅前薪資', () => {
    const shift = toShift(night)
    if (!shift) throw new Error('應該是有效班次')
    expect(shift.end.getTime() - shift.start.getTime()).toBe(370 * 60000)
    expect(shift.paidMinutes).toBe(340)
    expect(shift.grossCents).toBe(21250)
  })

  it('下班後顯示今天剛結束的班，晚上再顯示下一班', () => {
    const records = [night, day('2026-11-20')]
    expect(getFocusShift(records, new Date(2026, 10, 19, 9, 0)).kind).toBe('finished')
    const evening = getFocusShift(records, new Date(2026, 10, 18, 20, 0))
    expect(evening.kind).toBe('later-today')
    expect(evening.shift?.workDate).toBe('2026-11-18')
  })

  it('今天稍後的班優先於今天已結束的班', () => {
    const records = [day('2026-11-18', '06:00', '10:00'), day('2026-11-18', '18:00', '22:00')]
    const focus = getFocusShift(records, new Date(2026, 10, 18, 12, 0))
    expect(focus.kind).toBe('later-today')
    expect(focus.shift?.startTime).toBe('18:00')
  })

  it('沒有班、請假、之後才有班', () => {
    expect(getFocusShift([], new Date(2026, 10, 18, 9)).kind).toBe('none')
    const leave = { workDate: '2026-11-18', shiftType: 'leave', paidMinutes: 0 }
    expect(getFocusShift([leave, day('2026-11-21')], new Date(2026, 10, 18, 9)).kind).toBe('leave')
    const next = getFocusShift([day('2026-11-10'), day('2026-11-21')], new Date(2026, 10, 18, 9))
    expect(next.kind).toBe('next')
    expect(next.shift?.workDate).toBe('2026-11-21')
  })

  it('夏令時間開始當晚的夜班仍可算出班次', () => {
    // 雪梨 2026-10-04 02:00 進入夏令時間（在其他時區執行時同樣是本地時間計算）
    const dst = { ...night, workDate: '2026-10-03' }
    expect(getFocusShift([dst], new Date(2026, 9, 4, 4, 0)).kind).toBe('current')
  })
})

describe('顯示文字', () => {
  it('工時與開始時間', () => {
    expect(formatDuration(370)).toBe('6 小時 10 分')
    expect(formatDuration(480)).toBe('8 小時')
    expect(formatDuration(25)).toBe('25 分')
    const shift = toShift(day('2026-11-19'))
    if (!shift) throw new Error('應該是有效班次')
    expect(describeStart(shift, new Date(2026, 10, 18, 20))).toBe('明天 07:00 上班')
    expect(describeStart(shift, new Date(2026, 10, 19, 5))).toBe('2 小時後上班')
    expect(describeStart(shift, new Date(2026, 10, 16, 5))).toBe('11/19（四） 07:00 上班')
  })

  it('問候語只依時間', () => {
    expect(getGreeting(new Date(2026, 10, 18, 8))).toBe('早安')
    expect(getGreeting(new Date(2026, 10, 18, 2))).toBe('夜深了，記得休息')
    expect(getGreeting(new Date(2026, 10, 18, 2), true)).toBe('上班中，辛苦了')
  })
})

describe('待辦', () => {
  it('重複規則與後端一致', () => {
    expect(occursOn('NONE', '2026-11-18', '2026-11-18')).toBe(true)
    expect(occursOn('NONE', '2026-11-18', '2026-11-19')).toBe(false)
    expect(occursOn('DAILY', '2026-11-18', '2026-11-17')).toBe(false)
    expect(occursOn('WEEKLY', '2026-11-18', '2026-11-25')).toBe(true)
    expect(occursOn('WEEKLY', '2026-11-18', '2026-11-26')).toBe(false)
    expect(occursOn('MONTHLY', '2027-01-31', '2027-02-28')).toBe(true)
    expect(occursOn('MONTHLY', '2027-01-31', '2027-03-30')).toBe(false)
  })

  it('進度與日期', () => {
    expect(getTaskProgress([{ completed: true }, { completed: false }])).toEqual({
      done: 1,
      total: 2,
    })
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
  })
})

describe('getEarnedSoFar', () => {
  const shift = toShift(day('2026-11-23', '07:00', '15:00')) // 8 小時、$250

  it('依經過時間比例分攤預估稅前薪資', () => {
    expect(getEarnedSoFar(shift, new Date(2026, 10, 23, 9, 0))).toEqual({
      earnedCents: 6250,
      fraction: 0.25,
    })
  })

  it('開始前是 0，下班後是整個班的金額', () => {
    expect(getEarnedSoFar(shift, new Date(2026, 10, 23, 6, 0)).earnedCents).toBe(0)
    expect(getEarnedSoFar(shift, new Date(2026, 10, 23, 18, 0))).toEqual({
      earnedCents: 25000,
      fraction: 1,
    })
  })

  it('跨午夜的夜班也照實際經過時間計算', () => {
    const nightShift = toShift(night) // 23:50 → 06:00，共 370 分鐘、$212.50
    const result = getEarnedSoFar(nightShift, new Date(2026, 10, 19, 2, 55))
    expect(result.fraction).toBeCloseTo(185 / 370)
    expect(result.earnedCents).toBe(10625)
  })

  it('沒有班時回傳 0', () => {
    expect(getEarnedSoFar(null, new Date())).toEqual({ earnedCents: 0, fraction: 0 })
  })
})
