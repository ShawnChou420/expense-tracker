import { createI18n } from 'vue-i18n'
import { Locale } from 'vant'
import vantZhTW from 'vant/es/locale/lang/zh-TW'
import vantEnUS from 'vant/es/locale/lang/en-US'
import vantJaJP from 'vant/es/locale/lang/ja-JP'
import vantKoKR from 'vant/es/locale/lang/ko-KR'
import zhTW from '../locales/zh-TW.json'
import enAU from '../locales/en-AU.json'
import ja from '../locales/ja.json'
import ko from '../locales/ko.json'
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  resolveInitialLocale,
} from '../domain/locale.js'

const VANT_LOCALES = {
  'zh-TW': ['zh-TW', vantZhTW],
  'en-AU': ['en-US', vantEnUS],
  ja: ['ja-JP', vantJaJP],
  ko: ['ko-KR', vantKoKR],
}

function readSavedLocale() {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

function browserLanguages() {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

const initialLocale = resolveInitialLocale({
  saved: readSavedLocale(),
  browserLanguages: browserLanguages(),
})

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initialLocale,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { 'zh-TW': zhTW, 'en-AU': enAU, ja, ko },
  missingWarn: false,
  fallbackWarn: false,
})

/** 在 script（非元件）中取翻譯，例如 toast、Dialog 文字 */
export const t = (/** @type {string} */ key, /** @type {any} */ params) =>
  params === undefined ? i18n.global.t(key) : i18n.global.t(key, params)

export function currentLocale() {
  return /** @type {string} */ (i18n.global.locale.value)
}

/**
 * 套用語系：畫面文字、Vant 內建元件、<html lang> 同步更新，並記在 localStorage。
 * 不重新整理頁面，也不碰任何金額或貨幣設定。
 * @param {unknown} locale
 * @param {{ persist?: boolean }} [options]
 */
export function applyLocale(locale, { persist = true } = {}) {
  const next = normalizeLocale(locale) ?? DEFAULT_LOCALE
  i18n.global.locale.value = /** @type {any} */ (next)
  const [vantName, vantMessages] = VANT_LOCALES[next]
  Locale.use(vantName, vantMessages)
  if (typeof document !== 'undefined') document.documentElement.lang = next
  if (persist) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // 私密模式等情況寫不進去，仍可在本次瀏覽使用
    }
  }
  return next
}

// 初始化：不寫入 localStorage，讓「第一次進站依瀏覽器語言」在使用者選擇前持續有效
applyLocale(initialLocale, { persist: false })
