import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_MODULES,
  getDefaultLayout,
  getVisibleModuleIds,
  isSameLayout,
  moveModule,
  normalizeLayout,
  setModuleVisible,
} from './dashboardLayout.js'

const ALL = DASHBOARD_MODULES.length

describe('getDefaultLayout', () => {
  it('薪資優先：本週薪資在最前面，心情與稅務預設隱藏', () => {
    const layout = getDefaultLayout('PAY')
    expect(layout.modules).toHaveLength(ALL)
    expect(getVisibleModuleIds(layout).slice(0, 4)).toEqual([
      'weekly-pay',
      'latest-payslip',
      'today-shift',
      'savings-goal',
    ])
    expect(getVisibleModuleIds(layout)).not.toContain('mood-journal')
    expect(getVisibleModuleIds(layout)).not.toContain('tax-progress')
  })

  it('生活優先：今日班表、待辦、小語、心情在前，本週收入在後', () => {
    expect(getVisibleModuleIds(getDefaultLayout('LIFE')).slice(0, 5)).toEqual([
      'today-shift',
      'today-tasks',
      'daily-quote',
      'mood-journal',
      'weekly-pay',
    ])
  })

  it('沒有集簽設定時不顯示集簽進度；設定後才出現', () => {
    const layout = getDefaultLayout('PAY')
    expect(getVisibleModuleIds(layout)).not.toContain('visa-progress')
    expect(getVisibleModuleIds(layout, { hasVisa: true })).toContain('visa-progress')
  })
})

describe('normalizeLayout', () => {
  it('沒有設定、格式錯誤時用薪資優先預設', () => {
    expect(normalizeLayout(null)).toEqual(getDefaultLayout('PAY'))
    expect(normalizeLayout({ mode: 'LIFE' })).toEqual(getDefaultLayout('PAY'))
    expect(normalizeLayout('x')).toEqual(getDefaultLayout('PAY'))
  })

  it('保留使用者的順序與開關，忽略未知與重複的模組，補上新模組', () => {
    const layout = normalizeLayout({
      mode: 'LIFE',
      modules: [
        { id: 'daily-quote', visible: false },
        { id: 'removed-module', visible: true },
        { id: 'weekly-pay', visible: true },
        { id: 'weekly-pay', visible: false },
      ],
    })
    expect(layout.mode).toBe('LIFE')
    expect(layout.modules.slice(0, 2)).toEqual([
      { id: 'daily-quote', visible: false },
      { id: 'weekly-pay', visible: true },
    ])
    expect(layout.modules).toHaveLength(ALL)
    // 補上的模組沿用生活優先的預設
    expect(layout.modules.find((m) => m.id === 'mood-journal')?.visible).toBe(true)
    expect(layout.modules.find((m) => m.id === 'tax-progress')?.visible).toBe(false)
  })

  it('不支援的模式改成薪資優先', () => {
    expect(normalizeLayout({ mode: 'OTHER', modules: [] }).mode).toBe('PAY')
  })
})

describe('setModuleVisible / moveModule', () => {
  it('關閉小語只影響小語', () => {
    const layout = setModuleVisible(getDefaultLayout('PAY'), 'daily-quote', false)
    expect(getVisibleModuleIds(layout)).not.toContain('daily-quote')
    expect(getVisibleModuleIds(layout)).toContain('today-tasks')
  })

  it('上移、下移；到頭或到尾時不變', () => {
    const base = getDefaultLayout('PAY')
    const up = moveModule(base, 'today-shift', -1)
    expect(up.modules.slice(0, 3).map((m) => m.id)).toEqual([
      'weekly-pay',
      'today-shift',
      'latest-payslip',
    ])
    expect(moveModule(base, 'weekly-pay', -1)).toBe(base)
    const last = base.modules[base.modules.length - 1].id
    expect(moveModule(base, last, 1)).toBe(base)
    expect(moveModule(base, 'missing', 1)).toBe(base)
  })

  it('沒有集簽時，移動會跳過集簽進度', () => {
    const base = getDefaultLayout('PAY')
    const ids = base.modules.map((m) => m.id)
    const visaIndex = ids.indexOf('visa-progress')
    const before = ids[visaIndex - 1]
    const moved = moveModule(base, before, 1, { hasVisa: false })
    const movedIds = moved.modules.map((m) => m.id)
    expect(movedIds.indexOf(before)).toBe(visaIndex + 1)
    expect(movedIds.indexOf('visa-progress')).toBe(visaIndex - 1)
  })

  it('isSameLayout 比較內容', () => {
    expect(isSameLayout(getDefaultLayout('PAY'), getDefaultLayout('PAY'))).toBe(true)
    expect(isSameLayout(getDefaultLayout('PAY'), getDefaultLayout('LIFE'))).toBe(false)
  })
})
