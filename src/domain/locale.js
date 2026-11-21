// 介面語系：只影響畫面文字，與顯示貨幣、薪資或財務原始資料完全無關。

export const SUPPORTED_LOCALES = /** @type {const} */ (['zh-TW', 'en-AU', 'ja', 'ko'])
export const DEFAULT_LOCALE = 'zh-TW'
export const LOCALE_STORAGE_KEY = 'expense-tracker.locale'

/** 語言選單顯示名稱，一律用該語言自己的寫法，讓看不懂目前語言的人也找得到 */
export const LOCALE_OPTIONS = [
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-AU', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
]

/**
 * 把任意語言標籤（瀏覽器、localStorage、後端）轉成支援的語系；不支援回傳 null。
 * 簡體中文不支援，會回傳 null，最後由呼叫端退回繁體中文。
 * @param {unknown} tag
 * @returns {string | null}
 */
export function normalizeLocale(tag) {
  if (typeof tag !== 'string') return null
  const value = tag.trim().replace(/_/g, '-').toLowerCase()
  if (!value) return null
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === value)
  if (exact) return exact
  const [language, ...rest] = value.split('-')
  if (language === 'zh') {
    return rest.some((part) => ['tw', 'hk', 'mo', 'hant'].includes(part)) ? 'zh-TW' : null
  }
  if (language === 'en') return 'en-AU'
  if (language === 'ja') return 'ja'
  if (language === 'ko') return 'ko'
  return null
}

/**
 * 決定第一次顯示的語系：已儲存的選擇優先，其次是瀏覽器語言，都不支援就用繁體中文。
 * @param {{ saved?: unknown, browserLanguages?: readonly unknown[] }} [options]
 */
export function resolveInitialLocale({ saved, browserLanguages = [] } = {}) {
  const stored = normalizeLocale(saved)
  if (stored) return stored
  for (const language of browserLanguages) {
    const match = normalizeLocale(language)
    if (match) return match
  }
  return DEFAULT_LOCALE
}

/** @param {unknown} locale */
export function isSupportedLocale(locale) {
  return typeof locale === 'string' && SUPPORTED_LOCALES.includes(/** @type {any} */ (locale))
}
