import { describe, expect, it } from 'vitest'
import {
  daysUntilEnd,
  describeLastImport,
  discountPercent,
  isHalfPrice,
  isPromotionActive,
  promotionEndLabel,
  savingsCents,
  specialSubtitle,
  specialToShoppingItem,
} from './supermarketSpecials.js'
import { createShoppingItem } from './shopping.js'

const special = (overrides = {}) => ({
  id: 9,
  name: 'Tim Tam Original',
  brand: "Arnott's",
  packageSize: '200g',
  regularPriceCents: 500,
  salePriceCents: 250,
  promotionType: 'OTHER',
  promotionStart: '2026-11-19',
  promotionEnd: '2026-11-25',
  ...overrides,
})

describe('supermarket specials', () => {
  it('detects half price by type or by price, tolerating one cent of rounding', () => {
    expect(isHalfPrice(special())).toBe(true)
    expect(isHalfPrice(special({ regularPriceCents: 499, salePriceCents: 250 }))).toBe(true)
    expect(isHalfPrice(special({ regularPriceCents: 500, salePriceCents: 260 }))).toBe(false)
    expect(isHalfPrice(special({ regularPriceCents: null, promotionType: 'HALF_PRICE' }))).toBe(
      true,
    )
    expect(isHalfPrice(special({ regularPriceCents: null }))).toBe(false)
  })

  it('computes savings and discount only when a regular price is known', () => {
    expect(savingsCents(special({ regularPriceCents: 2200, salePriceCents: 1300 }))).toBe(900)
    expect(discountPercent(special({ regularPriceCents: 2200, salePriceCents: 1300 }))).toBe(41)
    expect(savingsCents(special({ regularPriceCents: null }))).toBeNull()
    expect(discountPercent(special({ regularPriceCents: 250 }))).toBeNull()
  })

  it('treats the end date as the last valid day and labels it', () => {
    expect(isPromotionActive(special(), '2026-11-25')).toBe(true)
    expect(isPromotionActive(special(), '2026-11-26')).toBe(false)
    expect(isPromotionActive(special(), '2026-11-18')).toBe(false)
    expect(daysUntilEnd(special(), '2026-11-21')).toBe(4)
    expect(promotionEndLabel(special(), '2026-11-21')).toBe('11/25 截止 · 還剩 4 天')
    expect(promotionEndLabel(special(), '2026-11-24')).toBe('明天截止')
    expect(promotionEndLabel(special(), '2026-11-25')).toBe('今天截止')
    expect(promotionEndLabel(special(), '2026-11-26')).toBe('特價已結束')
  })

  it('keeps day counting stable across the daylight-saving change', () => {
    // NSW 夏令時間 2026-10-04 開始
    expect(daysUntilEnd(special({ promotionEnd: '2026-10-05' }), '2026-10-03')).toBe(2)
  })

  it('turns a special into a valid shopping item with a price snapshot', () => {
    const item = createShoppingItem(specialToShoppingItem(special(), 'a1'))
    expect(item).toMatchObject({
      name: 'Tim Tam Original',
      packageSize: '200g',
      promotionId: 9,
      estimatedUnitPriceCents: 250,
      store: 'WOOLWORTHS',
    })
    expect(specialSubtitle(special())).toBe("Arnott's · 200g")
    expect(specialSubtitle(special({ brand: null }))).toBe('200g')
  })

  it('warns when data is missing, failed or partial', () => {
    expect(describeLastImport(null).warning).toBe(true)
    expect(describeLastImport({ status: 'FAILED', finishedAt: null }).text).toContain('失敗')
    expect(
      describeLastImport({
        status: 'PARTIAL',
        finishedAt: '2026-11-19T01:00:00Z',
      }).warning,
    ).toBe(true)
    expect(
      describeLastImport({
        status: 'SUCCESS',
        finishedAt: '2026-11-19T01:00:00Z',
      }).warning,
    ).toBe(false)
  })
})

describe('sync status', () => {
  it('formats the promotion period and warns when data may be stale', async () => {
    const { describeSyncStatus, formatPromotionPeriod } = await import('./supermarketSpecials.js')
    expect(formatPromotionPeriod('2026-11-26', '2026-12-02')).toBe('11/26–12/2')
    expect(formatPromotionPeriod(null, '2026-12-02')).toBe('')
    const base = {
      regionCode: 'NSW',
      lastSuccessAt: '2026-11-25T20:00:00Z',
      validFrom: '2026-11-26',
      validTo: '2026-12-02',
      stale: false,
      lastRun: { status: 'SUCCESS' },
    }
    expect(describeSyncStatus(base).warning).toBe('')
    expect(describeSyncStatus(base).period).toBe('11/26–12/2')
    expect(describeSyncStatus({ ...base, stale: true }).warning).toContain('過期')
    expect(describeSyncStatus({ ...base, lastRun: { status: 'FAILED' } }).warning).toContain('失敗')
    expect(describeSyncStatus({ ...base, lastSuccessAt: null }).warning).toBe('還沒有本週特價資料')
  })
})
