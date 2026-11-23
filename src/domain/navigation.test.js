import { describe, expect, it } from 'vitest'
import { buildDirectionsUrl, stationDestination } from './navigation.js'

describe('buildDirectionsUrl', () => {
  it('把目的地編碼進 Google 地圖路線網址', () => {
    expect(buildDirectionsUrl('Baiada Pendle Hill')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Baiada%20Pendle%20Hill',
    )
  })

  it('整理多餘空白、特殊字元也會編碼', () => {
    expect(buildDirectionsUrl('  7-Eleven,  1 Smith St & Co  ')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=7-Eleven%2C%201%20Smith%20St%20%26%20Co',
    )
  })

  it('沒有目的地時回傳 null', () => {
    expect(buildDirectionsUrl('')).toBeNull()
    expect(buildDirectionsUrl('   ')).toBeNull()
    expect(buildDirectionsUrl(null)).toBeNull()
  })
})

describe('stationDestination', () => {
  it('名稱加地址；缺少的部分略過', () => {
    expect(
      stationDestination({ name: 'Ampol Parramatta', address: '1 Church St, Parramatta NSW 2150' }),
    ).toBe('Ampol Parramatta, 1 Church St, Parramatta NSW 2150')
    expect(stationDestination({ name: 'Ampol', address: null })).toBe('Ampol')
  })
})
