import { parseLocalDate } from './date.js'
import { normalizeWorkRecord } from '../utils/workRecord.js'

/**
 * 請假類型。所有請假紀錄都是 shiftType = 'leave'，一律無薪，不產生工時與薪資；
 * leaveType 只說明原因（打工度假的工作沒有有薪假）。
 */
export const LEAVE_TYPES = /** @type {const} */ ([
  { id: 'PERSONAL', label: '事假' },
  { id: 'SICK', label: '病假' },
  { id: 'HOLIDAY', label: 'Holiday／旅行' },
  { id: 'UNPAID_OTHER', label: '其他無薪假' },
  { id: 'REST_DAY', label: '正常休息日' },
])

/** 舊的請假紀錄沒有類型 */
export const UNSPECIFIED_LEAVE = 'UNSPECIFIED'

/** @param {string | null | undefined} id */
export function getLeaveType(id) {
  return LEAVE_TYPES.find((type) => type.id === id) ?? null
}

/** @param {{ leaveType?: string | null }} record */
export function getLeaveLabel(record) {
  return getLeaveType(record.leaveType)?.label ?? '請假'
}

/** 有實際工作的紀錄（不含請假、沒有計薪時數的紀錄） @param {any} record */
export function isWorkedRecord(record) {
  return Boolean(record) && record.shiftType !== 'leave' && Number(record.paidMinutes) > 0
}

/**
 * 建立一筆請假紀錄。金額與工時一律為 0，所以不影響薪資預估。
 * @param {{ id: number, workDate: string, leaveType: string, remark?: string, source?: string | null, replacedWork?: unknown }} input
 */
export function createLeaveRecord({
  id,
  workDate,
  leaveType,
  remark = '',
  source = null,
  replacedWork = null,
}) {
  if (!parseLocalDate(workDate)) throw new Error('請選擇有效日期')
  const type = getLeaveType(leaveType)
  if (!type) throw new Error('請選擇請假類型')
  const record = normalizeWorkRecord({ id, workDate, startTime: '00:00', endTime: '00:00' })
  return {
    ...record,
    shiftType: 'leave',
    isCleaningDay: false,
    remark,
    designatedWork: false,
    prepMinutes: 0,
    leaveType: type.id,
    ...(source ? { source } : {}),
    ...(replacedWork ? { replacedWork } : {}),
  }
}

/**
 * 批次請假前的檢查：哪些日期可以直接改、哪些日期已有實際工作（衝突，需要使用者決定）。
 * @param {Array<any>} records
 * @param {string[]} dates
 */
export function planBatchLeave(records, dates) {
  const byDate = new Map()
  for (const record of records) byDate.set(record.workDate, record)
  const create = []
  const updateLeave = []
  const conflicts = []
  for (const date of dates) {
    const existing = byDate.get(date)
    if (!existing) create.push(date)
    else if (existing.shiftType === 'leave') updateLeave.push(existing)
    else conflicts.push(existing)
  }
  return { create, updateLeave, conflicts }
}

/**
 * 套用批次請假，回傳新的紀錄陣列（不修改原陣列）。
 * - 沒有紀錄的日期：新增請假紀錄。
 * - 已是請假：只改類型。
 * - 已有工作（衝突）：`conflictMode = 'SKIP'` 保留不動；`'REPLACE'` 改成請假，
 *   並把原本的上下班時間存在 replacedWork，之後可以恢復，不會無聲刪除。
 * @param {Array<any>} records
 * @param {string[]} dates
 * @param {{ leaveType: string, conflictMode?: 'SKIP' | 'REPLACE', nextId: () => number }} options
 */
export function applyBatchLeave(records, dates, { leaveType, conflictMode = 'SKIP', nextId }) {
  const wanted = new Set(dates)
  const { create } = planBatchLeave(records, dates)
  const result = records.map((record) => {
    if (!wanted.has(record.workDate)) return record
    if (record.shiftType === 'leave') {
      return createLeaveRecord({
        id: record.id,
        workDate: record.workDate,
        leaveType,
        remark: record.remark || '',
        source: record.source ?? null,
        replacedWork: record.replacedWork ?? null,
      })
    }
    if (conflictMode !== 'REPLACE') return record
    return createLeaveRecord({
      id: record.id,
      workDate: record.workDate,
      leaveType,
      remark: record.remark || '',
      source: record.source ?? null,
      replacedWork: {
        startTime: record.startTime,
        endTime: record.endTime,
        isCleaningDay: record.isCleaningDay === true,
        smokoCount: record.smokoCount,
        designatedWork: record.designatedWork === true,
      },
    })
  })
  for (const date of create) {
    result.push(createLeaveRecord({ id: nextId(), workDate: date, leaveType }))
  }
  return result
}
