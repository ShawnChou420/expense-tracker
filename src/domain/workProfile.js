import { RATE_FIELDS, getDefaultDerivedRate } from './payslip/rates.js'
import { parseLocalDate } from './date.js'

/**
 * 每位使用者自己的「工作設定」：薪資費率是否已確認、班別範本、每週排班與 Smoko 規則。
 * 這裡沒有任何個人預設值；未設定就是未設定，計算前必須先完成設定。
 */

export const PAY_STATUS = /** @type {const} */ ({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  MANUAL_CONFIRMED: 'MANUAL_CONFIRMED',
  PAYSLIP_CONFIRMED: 'PAYSLIP_CONFIRMED',
})

export const SCHEDULE_STATUS = /** @type {const} */ ({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONFIGURED: 'CONFIGURED',
})

/** 加成費率（不含基本時薪、PPE、扣稅）；國定假日目前固定以基本時薪 150% 估算，永遠視為未確認 */
export const LOADING_KEYS = RATE_FIELDS.filter(
  (field) => field.key !== 'baseRate' && field.key !== 'ppeAllowance',
).map((field) => field.key)

/**
 * Baiada 實務參考時間，只是建議值：使用者可修改，也不套用到其他雇主。
 * 時間由使用者提供。
 */
export const SHIFT_PRESETS = [
  { preset: 'BAIADA_EARLY', name: '早班', startTime: '06:00', endTime: '15:00', isCleaning: false },
  {
    preset: 'BAIADA_MIDDLE',
    name: '中班',
    startTime: '15:00',
    endTime: '23:50',
    isCleaning: false,
  },
  { preset: 'BAIADA_NIGHT', name: '晚班', startTime: '23:50', endTime: '06:00', isCleaning: false },
  {
    preset: 'BAIADA_CLEANING',
    name: '晚班清潔班',
    startTime: '17:45',
    endTime: '00:00',
    isCleaning: true,
  },
]

export const WEEKDAYS = [
  { day: 1, label: '一' },
  { day: 2, label: '二' },
  { day: 3, label: '三' },
  { day: 4, label: '四' },
  { day: 5, label: '五' },
  { day: 6, label: '六' },
  { day: 0, label: '日' },
]

/**
 * @typedef {{ id: string, name: string, startTime: string, endTime: string, isCleaning: boolean, preset: string | null }} ShiftTemplate
 * @typedef {{ mode: string, count: number, minutes: number, paid: boolean }} SmokoSetting
 * @typedef {{
 *   version: number,
 *   payStatus: 'NOT_CONFIGURED' | 'MANUAL_CONFIRMED' | 'PAYSLIP_CONFIRMED',
 *   confirmedRateKeys: string[],
 *   allowProvisionalRates: boolean,
 *   taxRateSource: { type: 'PAYSLIP_PERIOD' | 'MANUAL', payDate?: string | null } | null,
 *   scheduleStatus: 'NOT_CONFIGURED' | 'CONFIGURED',
 *   shiftTemplates: ShiftTemplate[],
 *   weekPlan: Record<string, string | null>,
 *   offDayRule: string,
 *   smoko: SmokoSetting,
 * }} WorkProfile
 */

/**
 * 全新的工作設定：什麼都沒設定
 * @returns {WorkProfile}
 */
export function createEmptyWorkProfile() {
  return {
    version: 1,
    payStatus: PAY_STATUS.NOT_CONFIGURED,
    // 已由薪資單或使用者確認的費率
    confirmedRateKeys: [],
    // 使用者是否明確同意：未確認的加成先用「基本時薪 × 預設倍率」暫估
    allowProvisionalRates: false,
    taxRateSource: null,
    scheduleStatus: SCHEDULE_STATUS.NOT_CONFIGURED,
    shiftTemplates: [],
    // 星期（0=日…6=六）→ 班別 id；null＝休息
    weekPlan: {},
    /** 沒有排班的日子：SKIP＝不建立紀錄；LEAVE＝建立休假紀錄 */
    offDayRule: 'SKIP',
    smoko: { mode: 'AUTO', count: 1, minutes: 30, paid: false },
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 把儲存的資料（可能是舊版或不完整）整理成完整的工作設定，不信任任何欄位。
 * @param {any} raw
 * @returns {WorkProfile}
 */
export function normalizeWorkProfile(raw) {
  const base = createEmptyWorkProfile()
  if (!raw || typeof raw !== 'object') return base
  const templates = Array.isArray(raw.shiftTemplates)
    ? raw.shiftTemplates
        .filter(
          (/** @type {any} */ item) =>
            item && TIME.test(item.startTime) && TIME.test(item.endTime) && item.id,
        )
        .map((/** @type {any} */ item) => ({
          id: String(item.id).slice(0, 40),
          name: String(item.name || '班別').slice(0, 20),
          startTime: item.startTime,
          endTime: item.endTime,
          isCleaning: item.isCleaning === true,
          preset: typeof item.preset === 'string' ? item.preset : null,
        }))
    : []
  const templateIds = new Set(templates.map((item) => item.id))
  /** @type {Record<string, string | null>} */
  const weekPlan = {}
  for (const { day } of WEEKDAYS) {
    const value = raw.weekPlan?.[day]
    weekPlan[day] = typeof value === 'string' && templateIds.has(value) ? value : null
  }
  const smokoMode = ['AUTO', 'FIXED'].includes(raw.smoko?.mode) ? raw.smoko.mode : 'AUTO'
  const smokoCount = Math.min(3, Math.max(0, Math.round(Number(raw.smoko?.count) || 0)))
  const smokoMinutes = Math.min(60, Math.max(0, Math.round(Number(raw.smoko?.minutes ?? 30))))
  return {
    ...base,
    payStatus: Object.values(PAY_STATUS).includes(raw.payStatus)
      ? raw.payStatus
      : PAY_STATUS.NOT_CONFIGURED,
    confirmedRateKeys: Array.isArray(raw.confirmedRateKeys)
      ? raw.confirmedRateKeys.filter(
          (/** @type {string} */ key) =>
            RATE_FIELDS.some((field) => field.key === key) || key === 'withholdingTaxRate',
        )
      : [],
    allowProvisionalRates: raw.allowProvisionalRates === true,
    taxRateSource:
      raw.taxRateSource && ['PAYSLIP_PERIOD', 'MANUAL'].includes(raw.taxRateSource.type)
        ? { type: raw.taxRateSource.type, payDate: raw.taxRateSource.payDate || null }
        : null,
    scheduleStatus:
      raw.scheduleStatus === SCHEDULE_STATUS.CONFIGURED && templates.length
        ? SCHEDULE_STATUS.CONFIGURED
        : SCHEDULE_STATUS.NOT_CONFIGURED,
    shiftTemplates: templates,
    weekPlan,
    offDayRule: raw.offDayRule === 'LEAVE' ? 'LEAVE' : 'SKIP',
    smoko: {
      mode: smokoMode,
      count: smokoCount,
      minutes: smokoMinutes,
      paid: raw.smoko?.paid === true,
    },
  }
}

/**
 * 舊會員（在工作設定上線前就存過費率）：不要誤判成新使用者，也不要改變他們原本的計算結果。
 * - 費率不是開發者的測試預設值（26.74）→ 視為手動確認過，未確認的加成沿用原本的預設倍率（暫定）
 * - 仍是測試預設值 → 視為尚未設定
 * @param {Record<string, unknown> | null} storedRates GET /salary-rates 的結果
 * @returns {WorkProfile}
 */
export function inferLegacyWorkProfile(storedRates) {
  const profile = createEmptyWorkProfile()
  const baseRate = Number(storedRates?.baseRate)
  if (!storedRates || !Number.isFinite(baseRate) || baseRate <= 0) return profile
  if (Math.abs(baseRate - 26.74) < 0.0001) return profile
  return {
    ...profile,
    payStatus: PAY_STATUS.MANUAL_CONFIRMED,
    confirmedRateKeys: ['baseRate', 'ppeAllowance', 'withholdingTaxRate'],
    allowProvisionalRates: true,
    taxRateSource: { type: 'MANUAL', payDate: null },
  }
}

/** @param {WorkProfile} profile @param {{ baseRate: number }} rates */
export function getSetupCompleteness(profile, rates) {
  const missing = []
  const payReady =
    profile.payStatus !== PAY_STATUS.NOT_CONFIGURED &&
    Number.isFinite(rates.baseRate) &&
    rates.baseRate > 0
  if (!payReady) missing.push('薪資費率')
  const hasTemplate = profile.shiftTemplates.length > 0
  if (!hasTemplate) missing.push('預設上下班時間')
  const hasWorkday = Object.values(profile.weekPlan).some((value) => value)
  if (!hasWorkday) missing.push('每週工作日')
  const scheduleReady =
    profile.scheduleStatus === SCHEDULE_STATUS.CONFIGURED && hasTemplate && hasWorkday
  if (hasTemplate && hasWorkday && !scheduleReady) missing.push('Smoko 規則')
  return { payReady, scheduleReady, ready: payReady && scheduleReady, missing }
}

/**
 * 某天依每週排班應該上什麼班；沒有排班時回傳 null（或依規則回傳休假）。
 * @param {WorkProfile} profile
 * @param {string} dateText YYYY-MM-DD
 */
export function getPlannedShift(profile, dateText) {
  const date = parseLocalDate(dateText)
  if (!date) return null
  const templateId = profile.weekPlan[date.getDay()]
  const template = profile.shiftTemplates.find((item) => item.id === templateId)
  if (!template) {
    return profile.offDayRule === 'LEAVE'
      ? {
          shiftType: 'leave',
          startTime: '00:00',
          endTime: '00:00',
          isCleaningDay: false,
          name: '休息',
        }
      : null
  }
  return {
    shiftType: 'normal',
    startTime: template.startTime,
    endTime: template.endTime,
    isCleaningDay: template.isCleaning,
    name: template.name,
  }
}

/** Smoko 設定 → 計算引擎的參數。自動＝沿用現有依工時判定（null）；計薪的 Smoko 不扣分鐘 */
export function getSmokoInputs(/** @type {SmokoSetting} */ smoko) {
  return {
    smokoCountOverride: smoko.mode === 'FIXED' ? smoko.count : null,
    deductMinutesPerBreak: smoko.paid ? 0 : smoko.minutes,
  }
}

/**
 * 計算用的加成費率：已確認的用實際值；未確認的，只有使用者同意暫估時才用預設倍率，否則為 0 並標示「未含」。
 * @param {Record<string, number>} values 目前保存的費率值
 * @param {WorkProfile} profile
 */
export function getEffectiveRates(values, profile) {
  const FULL_RATE_KEYS = RATE_FIELDS.filter((field) => field.mode === 'FULL').map((field) => field.key)
  const confirmed = new Set(profile.confirmedRateKeys)
  /** @type {Record<string, number>} */
  const rates = {}
  /** @type {Record<string, 'CONFIRMED' | 'PROVISIONAL' | 'EXCLUDED'>} */
  const status = {}
  for (const key of LOADING_KEYS) {
    if (confirmed.has(key) && Number.isFinite(values[key])) {
      rates[key] = values[key]
      status[key] = 'CONFIRMED'
    } else if (profile.allowProvisionalRates) {
      rates[key] = getDefaultDerivedRate(key, values.baseRate) ?? 0
      status[key] = 'PROVISIONAL'
    } else {
      // 加班（T/Half、Double）是「完整時薪」：未確認時仍以已確認的基本時薪計，只是不含加成；
      // 其他加給是額外加多少，未確認就不計入。兩者都會標示「未含」。
      rates[key] = FULL_RATE_KEYS.includes(key) && Number.isFinite(values.baseRate) ? values.baseRate : 0
      status[key] = 'EXCLUDED'
    }
  }
  return { rates, status }
}

const LOADING_USAGE = [
  { key: 'casualLoadingRate', hours: 'ordinaryHours', label: 'Casual 加給' },
  { key: 'shiftLoadingRate', hours: 'nightHours', label: '夜班加給' },
  { key: 'saturdayOrdLoadingRate', hours: 'satOrdHours', label: '週六加給' },
  { key: 'timeHalfRate', hours: 'timeHalfHours', label: '加班 1.5 倍加成' },
  { key: 'doubleRate', hours: 'doubleHours', label: '加班 2 倍加成' },
  { key: 'sundayLoadingRate', hours: 'sunOrdHours', label: '週日加給' },
]

/**
 * 這一班實際用到哪些「未確認」的費率，讓畫面標示「含未確認費率，僅供參考」或「未含 xx」。
 * @param {Record<string, number> | null} breakdown 計算引擎的 payBreakdown（加上 nightHours）
 * @param {Record<string, string>} status getEffectiveRates 的 status
 */
export function getRateFlags(breakdown, status) {
  if (!breakdown) return { provisional: [], excluded: [] }
  const provisional = []
  const excluded = []
  for (const usage of LOADING_USAGE) {
    if (!(Number(breakdown[usage.hours]) > 0)) continue
    if (status[usage.key] === 'PROVISIONAL') provisional.push(usage.label)
    if (status[usage.key] === 'EXCLUDED') excluded.push(usage.label)
  }
  if (Number(breakdown.holidayHours) > 0) provisional.push('國定假日加給')
  return { provisional, excluded }
}

/**
 * 填滿本週／本月前的預覽：只列出還沒有任何紀錄的日期，既有班表與休假一律不動。
 * @param {Array<{ workDate: string }>} records
 * @param {WorkProfile} profile
 * @param {string[]} dates 區間內所有日期
 */
export function planFill(records, profile, dates) {
  const existing = new Set(records.map((record) => record.workDate))
  const plan = []
  let skippedExisting = 0
  let offDays = 0
  for (const date of dates) {
    if (existing.has(date)) {
      skippedExisting += 1
      continue
    }
    const shift = getPlannedShift(profile, date)
    if (!shift) {
      offDays += 1
      continue
    }
    if (shift.shiftType === 'leave') offDays += 1
    plan.push({ date, ...shift })
  }
  return { plan, skippedExisting, offDays }
}

/** 由班別範本建立新的班別（id 由呼叫端提供，方便測試） */
export function createShiftTemplate(
  /** @type {string} */ id,
  /** @type {Partial<typeof SHIFT_PRESETS[number]>} */ source = {},
) {
  return {
    id,
    name: source.name || '自訂班別',
    startTime: source.startTime || '09:00',
    endTime: source.endTime || '17:00',
    isCleaning: source.isCleaning === true,
    preset: source.preset || null,
  }
}

/** 下班時間早於或等於上班時間＝跨午夜 */
export const crossesMidnight = (
  /** @type {{ startTime: string, endTime: string } | undefined} */ template,
) => !!template && template.endTime <= template.startTime

/**
 * 填滿預覽的摘要：新增幾筆班、幾筆休假、總計薪工時、預估稅前（cents），以及用到哪些未確認費率。
 * @param {Array<{ shiftType?: string, paidMinutes?: number, grossPay?: number, rateFlags?: { provisional?: string[], excluded?: string[] } }>} records
 */
export function summarizeFillPreview(records) {
  const worked = records.filter((record) => record.shiftType !== 'leave')
  const unique = (/** @type {string[]} */ labels) => [...new Set(labels)]
  return {
    shiftCount: worked.length,
    leaveCount: records.length - worked.length,
    paidMinutes: worked.reduce((total, record) => total + (Number(record.paidMinutes) || 0), 0),
    grossCents: worked.reduce(
      (total, record) => total + Math.round((Number(record.grossPay) || 0) * 100),
      0,
    ),
    rateFlags: {
      provisional: unique(worked.flatMap((record) => record.rateFlags?.provisional ?? [])),
      excluded: unique(worked.flatMap((record) => record.rateFlags?.excluded ?? [])),
    },
  }
}

/**
 * 班別摘要文字，例如「晚班 23:50–06:00（隔天）· 一三四五」。
 * @param {WorkProfile} profile
 */
export function describeWeekPlan(profile) {
  return profile.shiftTemplates
    .map((template) => {
      const days = WEEKDAYS.filter(({ day }) => profile.weekPlan[day] === template.id)
        .map(({ label }) => label)
        .join('')
      const time = `${template.startTime}–${template.endTime}${crossesMidnight(template) ? '（隔天）' : ''}`
      return days ? `${template.name} ${time} · 週${days}` : null
    })
    .filter(Boolean)
}

/** Smoko 設定的說明文字 */
export function describeSmoko(/** @type {SmokoSetting} */ smoko) {
  const count =
    smoko.mode === 'FIXED'
      ? `每班固定 ${smoko.count} 次`
      : '依工時自動（滿 4 小時 1 次、滿 8 小時 2 次）'
  return `${count} · 每次 ${smoko.minutes} 分鐘 · ${smoko.paid ? '照常計薪' : '不計薪（扣工時）'}`
}
