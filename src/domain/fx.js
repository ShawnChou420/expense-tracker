/**
 * 交易幣別（原始幣別）與換算。和 displayCurrency.js（顯示幣別）不同：
 * 這裡保存的是交易發生時的原始金額與幣別，換算後的 AUD cents 只在有匯率時才有值。
 *
 * - amountMinor：最小貨幣單位，依 ISO 4217；AUD／TWD／USD 都是 2 位（NT$1,500 → 150000）。
 * - fxRate：1 單位原幣 = fxRate AUD，最多 10 位小數，以字串保存避免浮點誤差。
 * - 換算：amountMinor × fxRate 四捨五入（half up）成 AUD cents，與後端 BigDecimal 規則相同。
 * - 沒有匯率的外幣：convertedAudCents = null，不可併入任何 AUD 合計。
 */

export const TRANSACTION_CURRENCIES = Object.freeze([
  { code: 'AUD', symbol: '$', exponent: 2 },
  { code: 'TWD', symbol: 'NT$', exponent: 2 },
  { code: 'USD', symbol: 'US$', exponent: 2 },
])

export const FX_SOURCES = Object.freeze({ MANUAL: 'MANUAL', OPEN_ER_API: 'OPEN_ER_API' })

const FX_SCALE = 10
const SCALE = 10n ** BigInt(FX_SCALE)

/** @param {string} code */
export function getTransactionCurrency(code) {
  return TRANSACTION_CURRENCIES.find((item) => item.code === code) ?? null
}

/**
 * 金額文字 → 最小貨幣單位（整數）。無效或 ≤ 0 回傳 null。
 * @param {string | number} value
 * @param {string} currency
 */
export function toMinorUnits(value, currency) {
  const info = getTransactionCurrency(currency)
  if (!info || value === '' || value === null || value === undefined) return null
  const text = String(value).trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > info.exponent) return null
  const minor = Number(whole + fraction.padEnd(info.exponent, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

/** @param {number} minor @param {string} currency */
export function minorToMajor(minor, currency) {
  const info = getTransactionCurrency(currency)
  return (Number(minor) || 0) / 10 ** (info?.exponent ?? 2)
}

/**
 * 正規化匯率字串（> 0、最多 10 位小數、上限 1000）。無效回傳 null。
 * @param {string | number | null | undefined} rate
 */
export function normalizeFxRate(rate) {
  if (rate === null || rate === undefined || rate === '') return null
  let text = typeof rate === 'number' ? rate.toFixed(FX_SCALE) : String(rate).trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  const fraction = text.split('.')[1] ?? ''
  if (fraction.length > FX_SCALE) return null
  const value = Number(text)
  if (!(value > 0) || value > 1000) return null
  return text
}

/**
 * 原始金額 × 匯率 → AUD cents（四捨五入），用 BigInt 避免浮點誤差。
 * @param {number} amountMinor
 * @param {string} fxRate normalizeFxRate 的結果
 */
export function convertToAudCents(amountMinor, fxRate) {
  const rate = normalizeFxRate(fxRate)
  if (!rate || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null
  const [whole, fraction = ''] = rate.split('.')
  const scaledRate = BigInt(whole + fraction.padEnd(FX_SCALE, '0'))
  const product = BigInt(amountMinor) * scaledRate
  const rounded = (product + SCALE / 2n) / SCALE
  const result = Number(rounded)
  return Number.isSafeInteger(result) ? result : null
}

/**
 * 依顯示用匯率表（1 AUD = rates[code]）算出交易用的匯率（1 原幣 = ? AUD）。
 * @param {string} currency
 * @param {Record<string, number> | null | undefined} audRates
 */
export function rateFromAudRates(currency, audRates) {
  if (currency === 'AUD') return '1'
  const perAud = Number(audRates?.[currency])
  if (!Number.isFinite(perAud) || perAud <= 0) return null
  return normalizeFxRate(1 / perAud)
}

/**
 * 交易的 AUD 換算欄位。AUD 一律 1:1；外幣沒有匯率就不換算。
 * @param {{ amountMinor: number, currency: string, fxRate?: string | null, fxRateDate?: string | null, fxSource?: string | null }} input
 * @returns {{ convertedAudCents: number | null, fxRate: string | null, fxRateDate: string | null, fxSource: string | null }}
 */
export function resolveConversion({ amountMinor, currency, fxRate, fxRateDate, fxSource }) {
  if (currency === 'AUD') {
    return { convertedAudCents: amountMinor, fxRate: null, fxRateDate: null, fxSource: null }
  }
  const rate = normalizeFxRate(fxRate)
  if (!rate) return { convertedAudCents: null, fxRate: null, fxRateDate: null, fxSource: null }
  return {
    convertedAudCents: convertToAudCents(amountMinor, rate),
    fxRate: rate,
    fxRateDate: fxRateDate || null,
    fxSource: Object.values(FX_SOURCES).includes(/** @type {any} */ (fxSource))
      ? /** @type {string} */ (fxSource)
      : FX_SOURCES.MANUAL,
  }
}

/**
 * 原始金額文字，例如 NT$1,500、US$12.50、$8.00。
 * @param {number} amountMinor
 * @param {string} currency
 */
export function formatOriginalAmount(amountMinor, currency) {
  const info = getTransactionCurrency(currency) ?? TRANSACTION_CURRENCIES[0]
  const value = minorToMajor(amountMinor, info.code)
  // 台幣習慣不顯示小數；有角分時才顯示
  const decimals = info.code === 'TWD' && Number.isInteger(value) ? 0 : 2
  return `${info.symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}
