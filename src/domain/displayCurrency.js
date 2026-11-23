import { formatAud } from './money.js'

/**
 * 顯示用的幣別。所有金額仍以 AUD cents 保存與計算，這裡只負責「依匯率換算後顯示」。
 * decimals：台幣、韓元等習慣不顯示小數。
 */
export const DISPLAY_CURRENCIES = [
  { code: 'AUD', name: '澳幣', symbol: '$', flag: '🇦🇺', decimals: 2 },
  { code: 'TWD', name: '台幣', symbol: 'NT$', flag: '🇹🇼', decimals: 0 },
  { code: 'NZD', name: '紐西蘭幣', symbol: 'NZ$', flag: '🇳🇿', decimals: 2 },
  { code: 'CNY', name: '人民幣', symbol: '¥', flag: '🇨🇳', decimals: 2 },
  { code: 'KRW', name: '韓元', symbol: '₩', flag: '🇰🇷', decimals: 0 },
  { code: 'THB', name: '泰銖', symbol: '฿', flag: '🇹🇭', decimals: 0 },
  { code: 'VND', name: '越南盾', symbol: '₫', flag: '🇻🇳', decimals: 0 },
  { code: 'USD', name: '美金', symbol: 'US$', flag: '🇺🇸', decimals: 2 },
  { code: 'CAD', name: '加幣', symbol: 'CA$', flag: '🇨🇦', decimals: 2 },
]

/** @param {string} code */
export function getDisplayCurrency(code) {
  return DISPLAY_CURRENCIES.find((item) => item.code === code) ?? DISPLAY_CURRENCIES[0]
}

/**
 * 實際能用的顯示幣別：沒有取得匯率時退回 AUD，避免顯示錯誤的換算金額。
 * @param {string} code
 * @param {Record<string, number>} rates 1 AUD = rates[code]
 */
export function resolveDisplayCurrency(code, rates) {
  const currency = getDisplayCurrency(code)
  if (currency.code === 'AUD') return { ...currency, rate: 1, fallback: false }
  const rate = Number(rates?.[currency.code])
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ...DISPLAY_CURRENCIES[0], rate: 1, fallback: true, requested: currency.code }
  }
  return { ...currency, rate, fallback: false }
}

/**
 * AUD cents → 顯示幣別的金額文字，例如 NT$12,345、$1,234.56。
 * @param {number} cents AUD cents
 * @param {{ code: string, rate: number } | null | undefined} currency resolveDisplayCurrency 的結果
 */
export function formatCentsIn(cents, currency) {
  if (!currency || currency.code === 'AUD') return formatAud(cents)
  const info = getDisplayCurrency(currency.code)
  const value = ((Number(cents) || 0) / 100) * currency.rate
  const text = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: info.decimals,
    maximumFractionDigits: info.decimals,
  })
  const rounded = Number(Math.abs(value).toFixed(info.decimals))
  return `${value < 0 && rounded !== 0 ? '-' : ''}${info.symbol}${text}`
}

/**
 * 隱藏金額：保留幣別符號，把數字（含正負號）換成 •••，不透露金額大小。
 * @param {string} text formatCentsIn 的結果，例如 "$1,240.00"、"-NT$300"
 */
export function maskAmount(text) {
  return String(text)
    .replace(/^-/, '')
    .replace(/[\d.,]+/, '•••')
}
