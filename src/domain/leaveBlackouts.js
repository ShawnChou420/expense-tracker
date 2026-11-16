import { parseLocalDate } from './date.js'

export function normalizeLeaveBlackout(value) {
  const date = String(value?.date ?? '')
  if (!parseLocalDate(date)) throw new Error('請選擇有效日期')
  const reason = String(value?.reason ?? '').trim()
  if (reason.length > 240) throw new Error('禁休說明不可超過 240 字')
  return { date, reason }
}

export function upsertLeaveBlackout(items, value) {
  const blackout = normalizeLeaveBlackout(value)
  return [...items.filter((item) => item.date !== blackout.date), blackout].sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}

export function removeLeaveBlackout(items, date) {
  return items.filter((item) => item.date !== date)
}

export const NOTICE_TITLE_MAX = 120
export const NOTICE_BODY_MAX = 5000

/**
 * 禁休公告（期間）。公告全文由使用者自行輸入或貼上；只做為提醒，
 * 不代表實際上班或請假，所以不影響薪資與集簽天數。
 * @param {any} value
 */
export function normalizeBlackoutNotice(value) {
  const id = String(value?.id ?? '')
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('無效公告 ID')
  const startDate = String(value?.startDate ?? '')
  const endDate = String(value?.endDate ?? '')
  if (!parseLocalDate(startDate)) throw new Error('請選擇禁休開始日')
  if (!parseLocalDate(endDate)) throw new Error('請選擇禁休結束日')
  if (endDate < startDate) throw new Error('禁休結束日不可早於開始日')
  const title = String(value?.title ?? '').trim()
  if (title.length > NOTICE_TITLE_MAX) throw new Error(`公告標題不可超過 ${NOTICE_TITLE_MAX} 字`)
  const body = String(value?.body ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (body.length > NOTICE_BODY_MAX) throw new Error(`公告全文不可超過 ${NOTICE_BODY_MAX} 字`)
  return { id, startDate, endDate, title, body }
}

/** 舊版單日禁休 → 顯示用的公告格式（legacy 標記，編輯時轉成新的公告） @param {{ date: string, reason: string }} item */
export function legacyBlackoutToNotice(item) {
  return {
    id: `legacy-${item.date}`,
    startDate: item.date,
    endDate: item.date,
    title: item.reason || '',
    body: '',
    legacyDate: item.date,
  }
}

/**
 * 某天適用的禁休公告（含舊版單日禁休）。
 * @template {{ startDate: string, endDate: string }} T
 * @param {T[]} notices
 * @param {string} date
 * @returns {T[]}
 */
export function getNoticesForDate(notices, date) {
  return notices.filter((notice) => notice.startDate <= date && date <= notice.endDate)
}

/** @param {Array<any>} items @param {any} notice */
export function upsertBlackoutNotice(items, notice) {
  return [...items.filter((item) => item.id !== notice.id), notice].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
  )
}
