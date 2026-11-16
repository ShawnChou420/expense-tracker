import { parseLocalDate } from './date.js'
import { addDays, daysBetweenInclusive } from './visaJourney.js'
import { createLeaveRecord, getLeaveType } from './leaveTypes.js'
import { getSmokoInputs, getTemplateTimes } from './workProfile.js'

/** 補登歷史班表的資料來源標記：使用者確認過，但不代表雇主或 Home Affairs 認定 */
export const HISTORY_SOURCE = 'HISTORICAL_USER_CONFIRMED'
/** 一次最多補登的天數（約 13 個月），避免一次產生過多紀錄 */
export const MAX_HISTORY_DAYS = 400

/**
 * @typedef {{
 *   date: string,
 *   kind: 'work' | 'leave' | 'rest',
 *   templateId: string | null,
 *   shiftName: string,
 *   startTime: string,
 *   endTime: string,
 *   isCleaningDay: boolean,
 *   smokoMode: 'AUTO' | 'MANUAL',
 *   smokoCount: number | null,
 *   leaveType: string | null,
 *   leavePaid: boolean,
 * }} HistoryDraft
 */

/**
 * 檢查補登期間。
 * @param {{ start: string, end: string, today: string }} range
 * @returns {string | null}
 */
export function validateHistoryRange({ start, end, today }) {
  if (!parseLocalDate(start)) return '請選擇開始日期'
  if (!parseLocalDate(end)) return '請選擇結束日期'
  if (end < start) return '結束日期不可早於開始日期'
  if (end > today) return '補登只能到今天，之後的日子請用「填滿本月」排班'
  if (daysBetweenInclusive(start, end) > MAX_HISTORY_DAYS) {
    return `一次最多補登 ${MAX_HISTORY_DAYS} 天，請分段補登`
  }
  return null
}

/**
 * 依使用者的每週排班產生歷史班表草稿。已有任何紀錄的日期一律略過（不覆蓋、不重複）。
 * 排休的日子列為休息日，不會保存成紀錄，除非使用者改成請假。
 * @param {{ records: Array<{ workDate: string }>, profile: any, start: string, end: string }} input
 */
export function createHistoryDrafts({ records, profile, start, end }) {
  const taken = new Set(records.map((record) => record.workDate))
  /** @type {HistoryDraft[]} */
  const drafts = []
  let skippedExisting = 0
  const smoko = getSmokoInputs(profile.smoko)
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (taken.has(date)) {
      skippedExisting += 1
      continue
    }
    const day = /** @type {Date} */ (parseLocalDate(date)).getDay()
    const templateId = profile.weekPlan?.[day] ?? null
    const template = profile.shiftTemplates.find(
      (/** @type {any} */ item) => item.id === templateId,
    )
    drafts.push({
      date,
      kind: template ? 'work' : 'rest',
      templateId: template?.id ?? null,
      shiftName: template?.name ?? '休息',
      startTime: template?.startTime ?? '',
      endTime: template?.endTime ?? '',
      isCleaningDay: false,
      smokoMode: smoko.smokoCountOverride === null ? 'AUTO' : 'MANUAL',
      smokoCount: smoko.smokoCountOverride,
      leaveType: null,
      leavePaid: false,
    })
  }
  return { drafts, skippedExisting }
}

/**
 * 一次修改多個日期（不修改原陣列）。
 * - `{ kind: 'leave', leaveType, leavePaid }`：改成請假
 * - `{ kind: 'rest' }`：改成休息日（不保存）
 * - `{ kind: 'work' }`：恢復成排班的上班（沒有排班的日子沿用第一個班別）
 * - `{ startTime, endTime }`、`{ smokoMode, smokoCount }`、`{ isCleaningDay }`：只改上班的日子
 * @param {HistoryDraft[]} drafts
 * @param {string[]} dates
 * @param {Partial<HistoryDraft>} patch
 * @param {any} profile
 * @returns {HistoryDraft[]}
 */
export function editHistoryDrafts(drafts, dates, patch, profile) {
  const selected = new Set(dates)
  return drafts.map((draft) => /** @type {HistoryDraft} */ (editOne(draft)))

  /** @param {HistoryDraft} draft */
  function editOne(draft) {
    if (!selected.has(draft.date)) return draft
    if (patch.kind === 'leave') {
      const type = getLeaveType(patch.leaveType)
      if (!type) return draft
      return {
        ...draft,
        kind: 'leave',
        leaveType: type.id,
        leavePaid: type.paidAllowed && patch.leavePaid === true,
      }
    }
    if (patch.kind === 'rest') return { ...draft, kind: 'rest', leaveType: null, leavePaid: false }
    if (patch.kind === 'work') {
      const template =
        profile.shiftTemplates.find((/** @type {any} */ item) => item.id === draft.templateId) ??
        profile.shiftTemplates[0]
      if (!template) return draft
      const times = getTemplateTimes(template, draft.isCleaningDay)
      return {
        ...draft,
        kind: 'work',
        templateId: template.id,
        shiftName: template.name,
        startTime: draft.startTime || times.startTime,
        endTime: draft.endTime || times.endTime,
        leaveType: null,
        leavePaid: false,
      }
    }
    if (draft.kind !== 'work') return draft
    const next = { ...draft }
    if (patch.isCleaningDay !== undefined) {
      next.isCleaningDay = patch.isCleaningDay
      const template = profile.shiftTemplates.find(
        (/** @type {any} */ item) => item.id === draft.templateId,
      )
      if (template) Object.assign(next, getTemplateTimes(template, patch.isCleaningDay))
    }
    if (patch.startTime !== undefined) next.startTime = patch.startTime
    if (patch.endTime !== undefined) next.endTime = patch.endTime
    if (patch.smokoMode !== undefined) {
      next.smokoMode = patch.smokoMode
      next.smokoCount =
        patch.smokoMode === 'MANUAL' ? Math.max(0, Number(patch.smokoCount) || 0) : null
    }
    return next
  }
}

/** @param {HistoryDraft[]} drafts */
export function summarizeHistoryDrafts(drafts) {
  return {
    work: drafts.filter((draft) => draft.kind === 'work').length,
    leave: drafts.filter((draft) => draft.kind === 'leave').length,
    rest: drafts.filter((draft) => draft.kind === 'rest').length,
  }
}

/**
 * 使用者確認後轉成班表紀錄。休息日不保存；保存前再排除已有紀錄的日期。
 * 上班紀錄由呼叫端用既有薪資計算建立（buildWork），這裡只加上來源標記。
 * @param {HistoryDraft[]} drafts
 * @param {{ records: Array<{ workDate: string }>, buildWork: (draft: HistoryDraft, id: number) => any, nextId: () => number }} options
 */
export function historyDraftsToRecords(drafts, { records, buildWork, nextId }) {
  const taken = new Set(records.map((record) => record.workDate))
  const result = []
  let invalid = 0
  for (const draft of drafts) {
    if (draft.kind === 'rest' || taken.has(draft.date)) continue
    if (draft.kind === 'leave' && draft.leaveType) {
      result.push(
        createLeaveRecord({
          id: nextId(),
          workDate: draft.date,
          leaveType: draft.leaveType,
          leavePaid: draft.leavePaid,
          source: HISTORY_SOURCE,
        }),
      )
      continue
    }
    const record = buildWork(draft, nextId())
    if (!record) {
      invalid += 1
      continue
    }
    result.push({ ...record, source: HISTORY_SOURCE, designatedWork: true })
  }
  return { records: result, invalid }
}
