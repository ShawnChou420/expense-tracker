import { describe, expect, it } from 'vitest'
import {
  checkReceiptFile,
  classifyImageError,
  computeTargetSize,
  grayscaleStretch,
  MAX_EDGE,
  MAX_PIXELS,
  MIN_EDGE,
  MAX_RECEIPT_FILE_BYTES,
  ReceiptImageError,
} from './imagePrep.js'

const codeOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return /** @type {any} */ (error).code
  }
  return null
}

describe('computeTargetSize', () => {
  it('已在範圍內的圖不縮放', () => {
    expect(computeTargetSize(1200, 1800)).toEqual({
      width: 1200,
      height: 1800,
      scale: 1,
      rotation: 0,
    })
  })

  it('小圖放大到長邊下限，最多 3 倍', () => {
    expect(computeTargetSize(600, 800)).toMatchObject({ width: 1200, height: MIN_EDGE, scale: 2 })
    expect(computeTargetSize(100, 200)).toMatchObject({ width: 300, height: 600, scale: 3 })
  })

  it('長邊縮到上限', () => {
    const size = computeTargetSize(1000, 4000)
    expect(size.height).toBe(MAX_EDGE)
    expect(size.width).toBe(500)
  })

  it('同時遵守總像素上限（12MP 相機原圖）', () => {
    const size = computeTargetSize(3024, 4032)
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_PIXELS)
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_EDGE)
    expect(size.width / size.height).toBeCloseTo(3024 / 4032, 2)
  })

  it('旋轉 90°／270° 時寬高互換，角度正規化', () => {
    expect(computeTargetSize(1800, 1200, { rotation: 90 })).toMatchObject({
      width: 1200,
      height: 1800,
      rotation: 90,
    })
    expect(computeTargetSize(1800, 1200, { rotation: -90 })).toMatchObject({
      width: 1200,
      height: 1800,
      rotation: 270,
    })
    expect(computeTargetSize(1800, 1200, { rotation: 360 })).toMatchObject({
      width: 1800,
      height: 1200,
      rotation: 0,
    })
  })

  it('寬高無效時視為格式不支援', () => {
    expect(codeOf(() => computeTargetSize(0, 100))).toBe('UNSUPPORTED')
    expect(codeOf(() => computeTargetSize(Number.NaN, 100))).toBe('UNSUPPORTED')
  })
})

describe('checkReceiptFile', () => {
  it('沒有檔案＝使用者取消', () => {
    expect(codeOf(() => checkReceiptFile(null))).toBe('CANCELLED')
  })
  it('拒絕非圖片、過大或空檔', () => {
    expect(codeOf(() => checkReceiptFile({ type: 'application/pdf', size: 10 }))).toBe('NOT_IMAGE')
    expect(
      codeOf(() => checkReceiptFile({ type: 'image/jpeg', size: MAX_RECEIPT_FILE_BYTES + 1 })),
    ).toBe('TOO_LARGE')
    expect(codeOf(() => checkReceiptFile({ type: 'image/jpeg', size: 0 }))).toBe('UNSUPPORTED')
  })
  it('接受圖片與沒有 MIME type 的檔案（交給解碼判斷）', () => {
    expect(() => checkReceiptFile({ type: 'image/heic', size: 1000 })).not.toThrow()
    expect(() => checkReceiptFile({ type: '', size: 1000 })).not.toThrow()
  })
})

describe('classifyImageError', () => {
  it('保留自訂錯誤碼', () => {
    expect(classifyImageError(new ReceiptImageError('TOO_LARGE'))).toBe('TOO_LARGE')
  })
  it('記憶體與格式錯誤', () => {
    expect(classifyImageError(new RangeError('Invalid array length'))).toBe('MEMORY')
    expect(classifyImageError(new Error('Canvas area exceeds the maximum limit'))).toBe('MEMORY')
    expect(classifyImageError(Object.assign(new Error('x'), { name: 'EncodingError' }))).toBe(
      'UNSUPPORTED',
    )
    expect(classifyImageError(new Error('The source image could not be decoded.'))).toBe(
      'UNSUPPORTED',
    )
    expect(classifyImageError(new Error('boom'))).toBe('UNKNOWN')
    expect(classifyImageError(undefined)).toBe('UNKNOWN')
  })
})

describe('grayscaleStretch', () => {
  it('轉成灰階並把亮度範圍拉滿', () => {
    const pixels = []
    for (let i = 0; i < 100; i += 1) {
      const value = 100 + i // 100–199 的灰
      pixels.push(value, value, value, 255)
    }
    const data = grayscaleStretch(new Uint8ClampedArray(pixels))
    const grays = []
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(data[i + 1])
      expect(data[i]).toBe(data[i + 2])
      expect(data[i + 3]).toBe(255)
      grays.push(data[i])
    }
    expect(Math.min(...grays)).toBe(0)
    expect(Math.max(...grays)).toBe(255)
  })

  it('幾乎單色的圖不拉伸（避免放大雜訊）', () => {
    const data = grayscaleStretch(new Uint8ClampedArray([200, 200, 200, 255, 205, 205, 205, 255]))
    expect([data[0], data[4]]).toEqual([200, 205])
  })

  it('彩色像素依亮度公式轉灰', () => {
    const data = grayscaleStretch(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(data[0]).toBe(76)
  })
})
