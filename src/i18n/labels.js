// domain 常數（支出分類、頻率等）的顯示名稱：依 id 查翻譯，查不到才用 domain 內的繁中 label。
// 儲存的資料只有 id，切換語言不會改動任何紀錄。
import { i18n, t } from './index.js'

/** @param {string} key @param {string | undefined} fallback */
function labelOr(key, fallback) {
  return i18n.global.te(key) ? t(key) : (fallback ?? '')
}

export const expenseGroupLabel = (/** @type {string} */ id, /** @type {string=} */ fallback) =>
  labelOr(`expenseGroups.${id}`, fallback)
export const expenseCategoryLabel = (/** @type {string} */ id, /** @type {string=} */ fallback) =>
  labelOr(`expenseCategories.${id}`, fallback)
export const expenseFrequencyLabel = (/** @type {string} */ id, /** @type {string=} */ fallback) =>
  labelOr(`expenseFrequencies.${id}`, fallback)
export const leaveTypeLabel = (/** @type {string | null | undefined} */ id, /** @type {string=} */ fallback) =>
  id ? labelOr(`leaveTypes.${id}`, fallback) : (fallback ?? t('payrollPage.leaveTag'))
export const leaveTypeShortLabel = (/** @type {string} */ id, /** @type {string=} */ fallback) =>
  labelOr(`leaveTypesShort.${id}`, fallback)
export const rateLabel = (/** @type {string} */ key, /** @type {string=} */ fallback) =>
  labelOr(`payrollPage.rates.${key}`, fallback)
