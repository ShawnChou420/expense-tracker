import { describe, expect, it } from 'vitest'
import { getMinimumWage, NATIONAL_MINIMUM_WAGES } from './minimumWage.js'
import {
  QUICK_HOURS,
  formatQuickHours,
  parseQuickHours,
  parseQuickRate,
  quickGrossCents,
} from './quickEstimate.js'

describe('quickGrossCents', () => {
  it('預設 A$26.44 × 38 小時 = A$1,004.72', () => {
    const wage = getMinimumWage('2026-11-20')
    expect(wage.hourlyCents).toBe(2644)
    expect(quickGrossCents(wage.hourlyCents, QUICK_HOURS.defaultHundredths)).toBe(100472)
  })

  it('簡易試算與官方週薪有進位差異，不當成法定週薪', () => {
    expect(quickGrossCents(2644, 3800)).not.toBe(NATIONAL_MINIMUM_WAGES[0].weeklyCents)
  })

  it('小數工時與時薪', () => {
    expect(quickGrossCents(3167, 3750)).toBe(118763) // 31.67 × 37.5 = 1187.625 → 1187.63
    expect(quickGrossCents(2644, 0)).toBe(0)
  })
})

describe('parseQuickRate', () => {
  it.each([
    ['31.67', 3167],
    ['A$31.67', 3167],
    ['$1,0', 2000],
    ['26.444', 2644],
    [' 45 ', 4500],
    ['１０', 2000],
    ['99', 6000],
    [26.44, 2644],
  ])('%s → %s', (input, cents) => {
    expect(parseQuickRate(input)).toBe(cents)
  })

  it.each(['', 'abc', '-5', '1.2.3', Number.NaN])('%s 無效', (input) => {
    expect(parseQuickRate(input)).toBeNull()
  })
})

describe('parseQuickHours', () => {
  it.each([
    ['37.5', 3750],
    ['38', 3800],
    ['37.3', 3725],
    ['37.4', 3750],
    ['80', 7000],
    [0, 0],
  ])('%s → %s', (input, hundredths) => {
    expect(parseQuickHours(input)).toBe(hundredths)
  })

  it('無效回傳 null', () => {
    expect(parseQuickHours('x')).toBeNull()
  })

  it('formatQuickHours 去掉多餘的 0', () => {
    expect(formatQuickHours(3750)).toBe('37.5')
    expect(formatQuickHours(3800)).toBe('38')
    expect(formatQuickHours(3725)).toBe('37.25')
  })
})

describe('getMinimumWage', () => {
  it('早於第一筆時用最早那筆；之後用最新生效的', () => {
    expect(getMinimumWage('2020-01-01')).toBe(NATIONAL_MINIMUM_WAGES[0])
    expect(getMinimumWage('2030-01-01')).toBe(NATIONAL_MINIMUM_WAGES.at(-1))
  })
})
