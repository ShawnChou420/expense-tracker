import { describe, expect, it } from 'vitest'
import { isValidTime } from '../utils/time.js'
import { parseTimeInput, timePickerFilter } from './timeInput.js'

describe('parseTimeInput', () => {
  it.each([
    ['17:00', '17:00'],
    ['1700', '17:00'],
    ['17', '17:00'],
    ['9:00', '09:00'],
    ['900', '09:00'],
    ['09:00', '09:00'],
    ['9', '09:00'],
    ['23:50', '23:50'],
    ['2350', '23:50'],
    ['0', '00:00'],
    ['000', '00:00'],
    ['24:00', '00:00'],
    ['17.30', '17:30'],
    ['17：30', '17:30'],
    ['  1730 ', '17:30'],
    ['17:07', '17:07'],
    ['１７３０', '17:30'],
  ])('%s → %s', (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected)
    expect(isValidTime(parseTimeInput(input))).toBe(true)
  })

  it.each(['25:00', '17:60', 'abc', '', '   ', '24:30', '12345', '17:5', '1:2:3', null, undefined])(
    '%s 無效',
    (input) => {
      expect(parseTimeInput(input)).toBeNull()
    },
  )
})

describe('timePickerFilter', () => {
  const minutes = Array.from({ length: 60 }, (_, i) => ({ value: String(i).padStart(2, '0') }))

  it('平常只列 5 的倍數', () => {
    expect(timePickerFilter('17:00')('minute', minutes).map((o) => o.value)).toHaveLength(12)
    expect(timePickerFilter('')('minute', minutes)).toHaveLength(12)
  })

  it('保留手動輸入的非 5 倍數分鐘', () => {
    const values = timePickerFilter('17:07')('minute', minutes).map((o) => o.value)
    expect(values).toContain('07')
    expect(values).toHaveLength(13)
  })

  it('小時不過濾', () => {
    const hours = [{ value: '00' }, { value: '07' }]
    expect(timePickerFilter('17:07')('hour', hours)).toEqual(hours)
  })
})
