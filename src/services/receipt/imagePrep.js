// 收據照片前處理：只在這台裝置的記憶體裡進行，照片不會上傳，也不會寫入任何紀錄。
// 流程：解碼（套用 EXIF 方向）→ 依需要旋轉 → 縮到 OCR 夠用的大小 → 灰階＋對比拉伸 → 輸出 JPEG Blob。
// 純計算（尺寸、錯誤分類、對比拉伸）另外匯出，方便單元測試。

/** 原始檔案上限：相機原圖通常 2–12 MB，超過這個多半不是收據照片 */
export const MAX_RECEIPT_FILE_BYTES = 30 * 1024 * 1024
/** 長邊上限：收據文字在這個解析度已足夠辨識 */
export const MAX_EDGE = 2000
/** 長邊下限：小圖放大到這個尺寸再辨識 */
export const MIN_EDGE = 1600
/** 總像素上限：避開 iOS Safari 的 canvas 大小與記憶體限制 */
export const MAX_PIXELS = 6_000_000

/** @typedef {'CANCELLED' | 'NOT_IMAGE' | 'TOO_LARGE' | 'UNSUPPORTED' | 'MEMORY' | 'UNKNOWN'} ReceiptImageErrorCode */

export class ReceiptImageError extends Error {
  /**
   * @param {ReceiptImageErrorCode} code
   * @param {unknown} [cause]
   */
  constructor(code, cause) {
    super(code)
    this.name = 'ReceiptImageError'
    this.code = code
    this.cause = cause
  }
}

/**
 * 縮放後的尺寸：長邊不超過 maxEdge、總像素不超過 maxPixels。
 * 太小的圖（長邊不到 minEdge）會放大，最多 3 倍：實測文字太小時 Tesseract 會整張辨識不到字。
 * rotation 是 90° 的倍數；轉 90°／270° 時寬高互換。
 * @param {number} width
 * @param {number} height
 * @param {{ rotation?: number, maxEdge?: number, minEdge?: number, maxPixels?: number }} [options]
 */
export function computeTargetSize(width, height, options = {}) {
  const { rotation = 0, maxEdge = MAX_EDGE, minEdge = MIN_EDGE, maxPixels = MAX_PIXELS } = options
  if (!(width > 0) || !(height > 0)) throw new ReceiptImageError('UNSUPPORTED')
  const quarter = (((Math.round(rotation / 90) % 4) + 4) % 4) * 90
  const [w, h] = quarter % 180 === 0 ? [width, height] : [height, width]
  const upscale = Math.min(3, Math.max(1, minEdge / Math.max(w, h)))
  const scale = Math.min(upscale, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / (w * h)))
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
    rotation: quarter,
  }
}

/**
 * 把各瀏覽器丟出的錯誤歸成畫面看得懂的幾種
 * @returns {ReceiptImageErrorCode}
 */
export function classifyImageError(error) {
  if (error instanceof ReceiptImageError) return error.code
  const name = error?.name || ''
  const message = String(error?.message || '')
  if (name === 'RangeError' || /memory|allocation|too large|exceeds/i.test(message)) return 'MEMORY'
  if (
    name === 'EncodingError' ||
    name === 'InvalidStateError' ||
    /decode|unsupported|format/i.test(message)
  )
    return 'UNSUPPORTED'
  return 'UNKNOWN'
}

/**
 * 檢查使用者選的檔案（不讀內容）
 * @param {{ type?: string, size: number, name?: string } | null | undefined} file
 */
export function checkReceiptFile(file) {
  if (!file) throw new ReceiptImageError('CANCELLED')
  // 有些 Android 相簿不給 MIME type；空字串時交給解碼步驟判斷
  if (file.type && !file.type.startsWith('image/')) throw new ReceiptImageError('NOT_IMAGE')
  if (file.size > MAX_RECEIPT_FILE_BYTES) throw new ReceiptImageError('TOO_LARGE')
  if (file.size === 0) throw new ReceiptImageError('UNSUPPORTED')
}

/**
 * RGBA → 灰階，並把亮度 2%–98% 百分位拉伸到 0–255（直接改寫傳入的陣列）。
 * 收據多半是灰底淡字，拉伸後文字對比較高，Tesseract 比較穩定。
 * @param {Uint8ClampedArray} data RGBA 像素
 */
export function grayscaleStretch(data) {
  const histogram = new Uint32Array(256)
  const pixels = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    data[i] = gray
    histogram[gray] += 1
  }
  const percentile = (ratio) => {
    const limit = pixels * ratio
    let count = 0
    for (let value = 0; value < 256; value += 1) {
      count += histogram[value]
      if (count > limit) return value
    }
    return 255
  }
  const low = percentile(0.02)
  const high = percentile(0.98)
  const range = high - low
  for (let i = 0; i < data.length; i += 4) {
    const value = range > 16 ? ((data[i] - low) * 255) / range : data[i]
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value
    data[i] = clamped
    data[i + 1] = clamped
    data[i + 2] = clamped
  }
  return data
}

/**
 * 解碼照片並套用 EXIF 方向。回傳的 source 用完要呼叫 release()。
 * @param {Blob} file
 * @returns {Promise<{ source: CanvasImageSource, width: number, height: number, release: () => void }>}
 */
export async function decodeReceiptImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch (error) {
      if (classifyImageError(error) === 'MEMORY') throw new ReceiptImageError('MEMORY', error)
      // 部分舊版 Safari 的 createImageBitmap 不支援某些格式，改用 <img> 再試一次
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw new ReceiptImageError('UNSUPPORTED', error)
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => {
      URL.revokeObjectURL(url)
      image.src = ''
    },
  }
}

/**
 * 產生給 OCR 與預覽用的圖片。
 * @param {{ source: CanvasImageSource, width: number, height: number }} decoded
 * @param {{ rotation?: number }} [options]
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function prepareReceiptImage(decoded, { rotation = 0 } = {}) {
  const size = computeTargetSize(decoded.width, decoded.height, { rotation })
  const canvas = document.createElement('canvas')
  try {
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new ReceiptImageError('MEMORY')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.translate(size.width / 2, size.height / 2)
    context.rotate((size.rotation * Math.PI) / 180)
    const drawWidth = decoded.width * size.scale
    const drawHeight = decoded.height * size.scale
    context.imageSmoothingQuality = 'high'
    context.drawImage(decoded.source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    context.setTransform(1, 0, 0, 1, 0, 0)
    const pixels = context.getImageData(0, 0, size.width, size.height)
    grayscaleStretch(pixels.data)
    context.putImageData(pixels, 0, 0)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new ReceiptImageError('MEMORY')
    return { blob, width: size.width, height: size.height }
  } catch (error) {
    throw error instanceof ReceiptImageError
      ? error
      : new ReceiptImageError(
          classifyImageError(error) === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'MEMORY',
          error,
        )
  } finally {
    // 立刻釋放 canvas 記憶體（iOS 對 canvas 總量有限制）
    canvas.width = 0
    canvas.height = 0
  }
}
