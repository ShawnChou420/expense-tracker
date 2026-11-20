/**
 * 訪客首頁的快速薪資試算：預估稅前薪資 ＝ 時薪 × 每週工時。
 * 只是體驗用的簡易公式，不含任何加成、扣除或稅金，也不寫入任何正式設定；
 * 正式薪資仍由 useShiftCalculator 計算。金額一律用整數 cents。
 */

/** 時薪：A$20–60，精度 0.01（滑桿與輸入框一致）。下限只是 UI 範圍，不代表合法最低時薪 */
export const QUICK_RATE = { minCents: 2000, maxCents: 6000, stepCents: 1 }
/** 每週工時：0–70 小時，精度 0.25 小時（以 1/100 小時儲存；滑桿與輸入框一致） */
export const QUICK_HOURS = { min: 0, max: 7000, step: 25, defaultHundredths: 3800 }

/** 試算沒有計入的項目（畫面上要列出） */
export const QUICK_ESTIMATE_EXCLUDES = [
  'Casual Loading',
  '夜班加成',
  '週末與假日加成',
  '加班費',
  'Smoko 扣除',
  'PPE 等津貼',
  'PAYG 稅額',
]

/**
 * @param {number} rateCents 時薪 cents
 * @param {number} hoursHundredths 工時（1/100 小時）
 * @returns {number} 稅前 cents（四捨五入到 cent）
 */
export function quickGrossCents(rateCents, hoursHundredths) {
  return Math.round((rateCents * hoursHundredths) / 100)
}

/**
 * 把輸入或滑桿的時薪整理成 cents：去掉 A$、$、逗號、空白，限制範圍。無效回傳 null。
 * @param {unknown} value
 */
export function parseQuickRate(value) {
  const number = toNumber(value)
  if (number === null) return null
  const cents = Math.round(number * 100)
  return Math.min(QUICK_RATE.maxCents, Math.max(QUICK_RATE.minCents, cents))
}

/**
 * 工時整理成 1/100 小時，進位到 0.25 小時，限制範圍。無效回傳 null。
 * @param {unknown} value
 */
export function parseQuickHours(value) {
  const number = toNumber(value)
  if (number === null) return null
  const quarters = Math.round((number * 100) / QUICK_HOURS.step) * QUICK_HOURS.step
  return Math.min(QUICK_HOURS.max, Math.max(QUICK_HOURS.min, quarters))
}

/** @param {unknown} value */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '')
    .replace(/[A$,\s]/gi, '')
    .replace(/[．。]/g, '.')
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  return Number(text)
}

/** @param {number} hundredths */
export function formatQuickHours(hundredths) {
  return String(Number((hundredths / 100).toFixed(2)))
}
