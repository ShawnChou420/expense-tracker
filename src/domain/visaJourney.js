import { formatLocalDate, parseLocalDate } from './date.js'
import { isWorkedRecord } from './leaveTypes.js'
import { getPlannedShift } from './workProfile.js'
import { getPayslipHighlights } from './payslip/summary.js'

/**
 * 集簽（WHM 417／462 specified work）個人進度估算。
 *
 * 規則依 Home Affairs「How to count specified work」（2026-11 查閱）：
 * - 二簽：至少 3 個月 = 88 個日曆天；三簽：至少 6 個月 = 179 個日曆天，都包含全職期間的週末或休息日。
 * - 二簽新制（Home Affairs 2026-11-17 公告，見 SECOND_VISA_RULE_CHANGE）：2027-03-01 起二簽改為 120 天；
 *   2027-02-28 前完成指定工作「並」遞交申請的人，仍適用 88 天（過渡期）。三簽不變。
 * - 需完成「該職務全職員工在 88／179 天內的正常工作天數」；兼職按比例折算。
 * - 一個日曆天最多算一天；無薪的假日與請假不能算。打工度假的工作沒有有薪假，請假一律視為無薪。
 * - 總期間不能短於 3／6 個日曆月。
 * - 工作必須在持有前一張 WHM 簽證期間完成（二簽靠第一簽期間、三簽靠第二簽期間）。
 *
 * 這只是個人估算，**不是 Home Affairs 的認定**。行業與郵遞區號是否符合、全職天數標準等，
 * 一律列在 reviewItems 讓使用者自行核對，不在這裡假設。
 */

export const VISA_GOALS = /** @type {const} */ ({
  SECOND: { id: 'SECOND', label: '集二簽', months: 3, minDays: 88, priorStage: 'FIRST' },
  THIRD: { id: 'THIRD', label: '集三簽', months: 6, minDays: 179, priorStage: 'SECOND' },
})

/**
 * 二簽指定工作天數的新制（Home Affairs 2026-11-17 公告）。日期與天數集中在這裡，官方調整時只改這裡。
 * 120 天如何換算成全職工作天，官方細則尚未公布：先比照 88 天的算法（日曆天、每週 5 天全職）估算，需以 Home Affairs 公告確認。
 */
export const SECOND_VISA_RULE_CHANGE = {
  announcedOn: '2026-11-17',
  registrationOpens: '2026-12-01',
  /** 過渡期：這天以前完成指定工作並遞交申請，仍適用 88 天 */
  transitionalDeadline: '2027-02-28',
  effectiveFrom: '2027-03-01',
  legacyMinDays: 88,
  newMinDays: 120,
  sourceUrl:
    'https://www.homeaffairs.gov.au/News-subsite/Pages/2026-Nov/working-holiday-maker-visa-application-rules-are-changing.aspx',
}

export const VISA_SUBCLASSES = ['417', '462']
export const VISA_STAGES = [
  { id: 'FIRST', label: '第一簽' },
  { id: 'SECOND', label: '第二簽' },
  { id: 'BRIDGING', label: '過渡簽證（Bridging）' },
]

/** 估算時假設的全職每週工作天數。官方以「該職務全職員工」為準，需自行核對。 */
export const FULL_TIME_DAYS_PER_WEEK = 5
/** 計薪時數達到標準工作天的這個比例就算一整天；更短的當天按比例折算並標示需核對 */
export const FULL_DAY_RATIO = 0.75
/** 用最近幾天的進度推算完成日 */
export const RATE_WINDOW_DAYS = 28
/** 至少要有幾天的資料才推算完成日 */
export const MIN_DAYS_FOR_ESTIMATE = 14

/** @typedef {{ goal: 'SECOND' | 'THIRD' | 'NONE' | null, subclass: '417' | '462' | null, stage: 'FIRST' | 'SECOND' | 'BRIDGING' | null, stayUntil: string | null, workStart: string | null, started: boolean, historyDismissed: boolean }} VisaJourneySettings */

/** @returns {VisaJourneySettings} */
export function createEmptyVisaJourney() {
  return {
    goal: null,
    subclass: null,
    stage: null,
    stayUntil: null,
    workStart: null,
    started: false,
    historyDismissed: false,
  }
}

/**
 * 整理儲存的設定，不信任任何欄位。
 * @param {any} raw
 * @returns {VisaJourneySettings}
 */
export function normalizeVisaJourney(raw) {
  const empty = createEmptyVisaJourney()
  if (!raw || typeof raw !== 'object') return empty
  const goal = ['SECOND', 'THIRD', 'NONE'].includes(raw.goal) ? raw.goal : null
  const date = (/** @type {unknown} */ value) =>
    typeof value === 'string' && parseLocalDate(value) ? value : null
  return {
    goal,
    subclass: VISA_SUBCLASSES.includes(raw.subclass) ? raw.subclass : null,
    stage: VISA_STAGES.some((stage) => stage.id === raw.stage) ? raw.stage : null,
    stayUntil: date(raw.stayUntil),
    workStart: date(raw.workStart),
    started: raw.started === true,
    historyDismissed: raw.historyDismissed === true,
  }
}

/**
 * 設定精靈送出前的檢查。只要求必要欄位；不集簽時其他欄位都可以空白。
 * @param {VisaJourneySettings} settings
 * @returns {string | null} 錯誤訊息
 */
export function validateVisaJourney(settings) {
  if (!settings.goal) return '請選擇集簽目標'
  if (settings.goal === 'NONE') return null
  if (!settings.subclass) return '請選擇簽證類型（417 或 462）'
  if (!settings.stage) return '請選擇目前的簽證階段'
  if (!settings.stayUntil) return '請輸入簽證 Stay until 日期'
  if (!settings.workStart) return '請輸入指定工作開始日期'
  if (settings.workStart > settings.stayUntil) return '指定工作開始日期不可晚於 Stay until'
  return null
}

/** @param {string} dateText @param {number} days */
export function addDays(dateText, days) {
  const date = parseLocalDate(dateText)
  if (!date) return dateText
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

/** @param {string} from @param {string} to 含頭含尾的天數 */
export function daysBetweenInclusive(from, to) {
  const a = parseLocalDate(from)
  const b = parseLocalDate(to)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

/** 全職每週 5 天換算：88 天 → 63 個工作天，179 天 → 128 個工作天 @param {number} minDays */
export function getRequiredWorkDays(minDays) {
  return Math.ceil((minDays * FULL_TIME_DAYS_PER_WEEK) / 7)
}

/** @param {number[]} values */
function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const round1 = (/** @type {number} */ value) => Math.round(value * 10) / 10

/**
 * 每一天的分類，給日曆與進度使用。
 * @typedef {'ACTUAL_WORK' | 'HISTORICAL_WORK' | 'PARTIAL_DAY' | 'UNPAID_LEAVE' | 'REST_DAY' | 'MISSING' | 'FUTURE_PLANNED' | 'OUTSIDE_VISA'} DayStatus
 */

/**
 * @param {{
 *   settings: VisaJourneySettings,
 *   records?: Array<any>,
 *   payslips?: Array<any>,
 *   profile?: any,
 *   today: string,
 * }} input
 */
export function getVisaJourneyProgress(input) {
  const { settings, today } = input
  if (!settings || !settings.goal || settings.goal === 'NONE') return null
  const rule = SECOND_VISA_RULE_CHANGE
  if (settings.goal !== 'SECOND') {
    const result = computeProgress(VISA_GOALS[settings.goal], input)
    result.reviewItems.push(registrationItem(today))
    return { ...result, rule: null }
  }
  // 二簽：先用 88 天估算；過渡期內預計能在期限前完成，才沿用 88 天，否則改用 120 天
  const legacy = computeProgress(VISA_GOALS.SECOND, input)
  const finishesInTime =
    legacy.status === 'LIKELY_MET' ||
    (legacy.estimate.date !== null && legacy.estimate.date <= rule.transitionalDeadline)
  if (today <= rule.transitionalDeadline && finishesInTime) {
    legacy.reviewItems.push({
      code: 'SECOND_VISA_TRANSITION',
      message: `二簽過渡期：要在 ${rule.transitionalDeadline} 前完成 ${rule.legacyMinDays} 天指定工作，並在同一天以前遞交二簽申請，才適用 ${rule.legacyMinDays} 天；來不及就改為 ${rule.newMinDays} 天，並需要先登記、獲選。`,
    })
    return { ...legacy, rule: { id: 'TRANSITIONAL', deadline: rule.transitionalDeadline } }
  }
  const next = computeProgress(
    { ...VISA_GOALS.SECOND, months: null, minDays: rule.newMinDays },
    input,
  )
  next.assumptions.push(
    `${rule.effectiveFrom} 起二簽指定工作由 ${rule.legacyMinDays} 天提高到 ${rule.newMinDays} 天；之前完成的指定工作仍然計入。${rule.newMinDays} 天的全職天數換算比照舊制估算，需以 Home Affairs 公告確認。`,
  )
  next.reviewItems.push(registrationItem(today))
  return { ...next, rule: { id: 'NEW', effectiveFrom: rule.effectiveFrom } }
}

/** 新制登記與邀請：二簽、三簽都適用（英國護照除外） @param {string} today */
function registrationItem(today) {
  const rule = SECOND_VISA_RULE_CHANGE
  return {
    code: 'REGISTRATION_REQUIRED',
    message:
      today < rule.effectiveFrom
        ? `${rule.registrationOpens} 起開放登記；${rule.effectiveFrom} 起申請下一張 WHM 簽證前，必須先登記、獲選並完成指定工作（英國護照除外）。登記不保證獲選。`
        : `申請下一張 WHM 簽證前，必須先登記、獲選並完成指定工作（英國護照除外）。登記不保證獲選。`,
  }
}

/**
 * 依某個天數規則計算進度。
 * @param {{ id: string, label: string, months: number | null, minDays: number, priorStage: string }} goal
 * @param {{ settings: VisaJourneySettings, records?: Array<any>, payslips?: Array<any>, profile?: any, today: string }} input
 */
function computeProgress(goal, { settings, records = [], payslips = [], profile = null, today }) {
  const requiredWorkDays = getRequiredWorkDays(goal.minDays)
  /** @type {Array<{ code: string, message: string, dates?: string[] }>} */
  const reviewItems = []
  const assumptions = [
    goal.months
      ? `依官方規則，${goal.label}需要至少 ${goal.months} 個月（${goal.minDays} 個日曆天）的指定工作。`
      : `依官方規則，${goal.label}需要至少 ${goal.minDays} 天的指定工作。`,
    `以每週 ${FULL_TIME_DAYS_PER_WEEK} 天全職換算，約需 ${requiredWorkDays} 個完整工作天；實際標準以你的職務與產業為準。`,
    '工作行業與工作地點郵遞區號是否屬於指定工作，需自行對照 Home Affairs 公告。',
    '請假（事假、病假、Holiday 等）一律視為無薪，不計入工作天。',
  ]

  if (settings.stage && settings.stage !== goal.priorStage) {
    reviewItems.push({
      code: settings.stage === 'BRIDGING' ? 'BRIDGING_VISA' : 'STAGE_MISMATCH',
      message:
        settings.stage === 'BRIDGING'
          ? '持有過渡簽證期間的工作只有特定情況可以計入，需自行核對。'
          : `${goal.label}的工作必須在持有${goal.priorStage === 'FIRST' ? '第一' : '第二'}張 WHM 簽證期間完成，你目前的簽證階段不同，需自行核對。`,
    })
  }

  const workStart = settings.workStart
  if (!workStart) {
    return {
      goal: goal.id,
      label: goal.label,
      minDays: goal.minDays,
      requiredWorkDays,
      status: 'NEEDS_SETUP',
      counts: null,
      creditedDays: 0,
      remainingDays: requiredWorkDays,
      percent: 0,
      firstWorkDate: null,
      calendarSpanDays: 0,
      calendarMinimumMet: false,
      estimate: { date: null, basis: null, reason: '請先設定指定工作開始日期' },
      payslip: { supportedDays: 0, checkedPayslips: 0 },
      reviewItems,
      assumptions,
      hasHistory: false,
      days: [],
    }
  }
  const stayUntil = settings.stayUntil
  const countedEnd = stayUntil && stayUntil < today ? stayUntil : today
  if (stayUntil && stayUntil < today) {
    reviewItems.push({ code: 'VISA_ENDED', message: 'Stay until 已過，之後的工作不計入這次集簽。' })
  }

  // 同一天只看一筆紀錄（一個日曆天最多算一天）
  const byDate = new Map()
  for (const record of records) {
    if (!record?.workDate) continue
    const existing = byDate.get(record.workDate)
    if (!existing || (isWorkedRecord(record) && !isWorkedRecord(existing))) {
      byDate.set(record.workDate, record)
    }
  }

  const workedMinutes = [...byDate.values()]
    .filter(
      (record) =>
        isWorkedRecord(record) && record.workDate >= workStart && record.workDate <= countedEnd,
    )
    .map((record) => Number(record.paidMinutes))
  const standardMinutes = median(workedMinutes)
  if (standardMinutes) {
    assumptions.push(
      `以你班表的中位數 ${round1(standardMinutes / 60)} 小時視為一個完整工作天；明顯較短的日子按比例折算。`,
    )
  }

  /** @type {Array<{ date: string, status: DayStatus, credit: number }>} */
  const days = []
  const counts = {
    actualDays: 0,
    historicalDays: 0,
    partialDays: 0,
    unpaidLeaveDays: 0,
    restDays: 0,
    missingDays: 0,
    plannedDays: 0,
  }
  const missingDates = []
  const partialDates = []
  let hasHistory = false

  for (let date = workStart; date <= countedEnd; date = addDays(date, 1)) {
    const record = byDate.get(date)
    if (!record) {
      // 沒有紀錄：依每週排班應該上班的日子才算「缺資料」，原本就排休的日子視為休息日
      const planned = profile ? getPlannedShift(profile, date) : null
      if (planned && planned.shiftType !== 'leave') {
        counts.missingDays += 1
        missingDates.push(date)
        days.push({ date, status: 'MISSING', credit: 0 })
      } else {
        counts.restDays += 1
        days.push({ date, status: 'REST_DAY', credit: 0 })
      }
      continue
    }
    if (isWorkedRecord(record)) {
      const historical = record.source === 'HISTORICAL_USER_CONFIRMED'
      if (historical) hasHistory = true
      const ratio = standardMinutes ? Number(record.paidMinutes) / standardMinutes : 1
      if (ratio >= FULL_DAY_RATIO) {
        if (historical) counts.historicalDays += 1
        else counts.actualDays += 1
        days.push({ date, status: historical ? 'HISTORICAL_WORK' : 'ACTUAL_WORK', credit: 1 })
      } else {
        counts.partialDays += 1
        partialDates.push(date)
        days.push({ date, status: 'PARTIAL_DAY', credit: Math.round(ratio * 100) / 100 })
      }
      continue
    }
    if (record.shiftType === 'leave') {
      if (record.leaveType === 'REST_DAY') {
        counts.restDays += 1
        days.push({ date, status: 'REST_DAY', credit: 0 })
      } else {
        // 請假一律無薪，不計入工作天
        counts.unpaidLeaveDays += 1
        days.push({ date, status: 'UNPAID_LEAVE', credit: 0 })
      }
      continue
    }
    // 有紀錄但沒有計薪時數（例如時間不完整）
    counts.missingDays += 1
    missingDates.push(date)
    days.push({ date, status: 'MISSING', credit: 0 })
  }

  // Stay until 之後的工作，以及今天以後已排的班（只顯示，不計入）
  for (const record of byDate.values()) {
    if (!isWorkedRecord(record)) continue
    if (stayUntil && record.workDate > stayUntil && record.workDate <= today) {
      days.push({ date: record.workDate, status: 'OUTSIDE_VISA', credit: 0 })
    } else if (
      record.workDate > today &&
      (!stayUntil || record.workDate <= stayUntil) &&
      record.workDate >= workStart
    ) {
      counts.plannedDays += 1
    }
  }

  if (missingDates.length) {
    reviewItems.push({
      code: 'MISSING_RECORDS',
      message: `${missingDates.length} 個排班日沒有任何紀錄，請補上出勤或請假。`,
      dates: missingDates,
    })
  }
  if (partialDates.length) {
    reviewItems.push({
      code: 'PARTIAL_DAYS',
      message: `${partialDates.length} 天的工時明顯少於你平常的一天，已按比例折算，需核對是否為產業標準工時。`,
      dates: partialDates,
    })
  }

  // 薪資單：只當作工時佐證，不產生出勤日期，也不重複計算
  const payslip = checkPayslips(payslips, byDate, workStart, countedEnd, reviewItems)

  const credited = days
    .filter((day) => day.date <= countedEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
  const creditedDays = round1(credited.reduce((sum, day) => sum + day.credit, 0))
  const firstWorkDate = credited.find((day) => day.credit > 0)?.date ?? null
  const calendarSpanDays = firstWorkDate ? daysBetweenInclusive(firstWorkDate, countedEnd) : 0
  const remainingDays = round1(Math.max(0, requiredWorkDays - creditedDays))
  const percent = Math.min(100, round1((creditedDays / requiredWorkDays) * 100))

  // 不得早於最短日曆期間
  const earliestByCalendar = firstWorkDate ? addDays(firstWorkDate, goal.minDays - 1) : null
  /** @type {{ date: string | null, basis: 'REACHED' | 'RECENT_RATE' | null, reason: string | null, beyondStayUntil?: boolean }} */
  let estimate
  if (remainingDays === 0 && firstWorkDate) {
    let sum = 0
    let reachedOn = countedEnd
    for (const day of credited) {
      sum += day.credit
      if (sum >= requiredWorkDays) {
        reachedOn = day.date
        break
      }
    }
    const date =
      earliestByCalendar && earliestByCalendar > reachedOn ? earliestByCalendar : reachedOn
    estimate = { date, basis: 'REACHED', reason: null }
  } else {
    estimate = estimateFromRecentRate({
      credited,
      countedEnd,
      firstWorkDate,
      remainingDays,
      earliestByCalendar,
      missingDates,
    })
  }
  if (estimate.date && stayUntil && estimate.date > stayUntil) {
    estimate.beyondStayUntil = true
    reviewItems.push({
      code: 'BEYOND_STAY_UNTIL',
      message: '照目前的進度，可能無法在簽證 Stay until 之前完成。',
    })
  }

  const calendarMinimumMet = calendarSpanDays >= goal.minDays
  const status =
    creditedDays === 0
      ? 'NOT_STARTED'
      : remainingDays === 0 && calendarMinimumMet
        ? 'LIKELY_MET'
        : 'IN_PROGRESS'

  return {
    goal: goal.id,
    label: goal.label,
    minDays: goal.minDays,
    requiredWorkDays,
    status,
    counts,
    creditedDays,
    remainingDays,
    percent,
    firstWorkDate,
    calendarSpanDays,
    calendarMinimumMet,
    estimate,
    payslip,
    reviewItems,
    assumptions,
    hasHistory,
    days,
  }
}

/**
 * @param {{ credited: Array<{ date: string, credit: number }>, countedEnd: string, firstWorkDate: string | null, remainingDays: number, earliestByCalendar: string | null, missingDates: string[] }} input
 * @returns {{ date: string | null, basis: 'REACHED' | 'RECENT_RATE' | null, reason: string | null, beyondStayUntil?: boolean }}
 */
function estimateFromRecentRate({
  credited,
  countedEnd,
  firstWorkDate,
  remainingDays,
  earliestByCalendar,
  missingDates,
}) {
  if (!firstWorkDate) return { date: null, basis: null, reason: '還沒有工作紀錄' }
  const windowStart = addDays(countedEnd, -(RATE_WINDOW_DAYS - 1))
  const from = firstWorkDate > windowStart ? firstWorkDate : windowStart
  const span = daysBetweenInclusive(from, countedEnd)
  if (span < MIN_DAYS_FOR_ESTIMATE) {
    return {
      date: null,
      basis: null,
      reason: `資料不足：至少需要 ${MIN_DAYS_FOR_ESTIMATE} 天的紀錄`,
    }
  }
  if (missingDates.some((date) => date >= from)) {
    return { date: null, basis: null, reason: '最近有排班日缺少紀錄，補齊後才能估算' }
  }
  const recent = credited
    .filter((day) => day.date >= from)
    .reduce((sum, day) => sum + day.credit, 0)
  if (recent <= 0) return { date: null, basis: null, reason: '最近沒有工作紀錄，無法估算' }
  const rate = recent / span
  const projected = addDays(countedEnd, Math.ceil(remainingDays / rate))
  const date = earliestByCalendar && earliestByCalendar > projected ? earliestByCalendar : projected
  return { date, basis: 'RECENT_RATE', reason: null }
}

/**
 * 薪資單比對：有期間的薪資單才比對；同一期間只算一次（避免重複匯入的影響）。
 * @param {Array<any>} payslips
 * @param {Map<string, any>} byDate
 * @param {string} workStart
 * @param {string} countedEnd
 * @param {Array<{ code: string, message: string, dates?: string[] }>} reviewItems
 */
export function checkPayslips(payslips, byDate, workStart, countedEnd, reviewItems) {
  const seen = new Set()
  const supported = new Set()
  let checked = 0
  for (const payslip of payslips) {
    const start = payslip?.periodStart
    const end = payslip?.periodEnd
    if (!start || !end || end < workStart || start > countedEnd) continue
    const key = `${start}|${end}`
    if (seen.has(key)) continue
    seen.add(key)
    checked += 1
    const worked = [...byDate.values()].filter(
      (record) => isWorkedRecord(record) && record.workDate >= start && record.workDate <= end,
    )
    const payslipHours = getPayslipHighlights(payslip).hours
    const scheduleHours = worked.reduce((sum, record) => sum + Number(record.paidMinutes) / 60, 0)
    if (!worked.length) {
      reviewItems.push({
        code: 'PAYSLIP_WITHOUT_SCHEDULE',
        message: `薪資單 ${start}–${end} 期間沒有班表紀錄；請補登實際出勤日期（系統不會自行推算）。`,
      })
      continue
    }
    if (payslipHours !== null && Math.abs(scheduleHours - payslipHours) / payslipHours > 0.15) {
      reviewItems.push({
        code: 'HOURS_MISMATCH',
        message: `薪資單 ${start}–${end}：薪資單 ${round1(payslipHours)} 小時、班表 ${round1(scheduleHours)} 小時，差距較大，請核對。`,
      })
      continue
    }
    for (const record of worked) supported.add(record.workDate)
  }
  return { supportedDays: supported.size, checkedPayslips: checked }
}
