/**
 * 薪資頁單日編輯器的「未儲存修改」判斷。
 *
 * 基準值在每次把某天載入編輯器時記下；目前的值和基準值不同，就是有未儲存修改。
 * 改了又改回原值不算修改。
 */

/**
 * @typedef {object} DayEditorState
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} shiftType normal | leave
 * @property {boolean} isCleaningDay
 * @property {string} remark
 * @property {number | null} smokoCountOverride
 */

/**
 * @param {Partial<DayEditorState>} state
 * @returns {DayEditorState}
 */
export function snapshotDayEditor(state) {
  return {
    startTime: state.startTime ?? '',
    endTime: state.endTime ?? '',
    shiftType: state.shiftType || 'normal',
    isCleaningDay: state.isCleaningDay === true,
    remark: (state.remark ?? '').trim(),
    smokoCountOverride:
      typeof state.smokoCountOverride === 'number' && Number.isInteger(state.smokoCountOverride)
        ? state.smokoCountOverride
        : null,
  }
}

/**
 * @param {Partial<DayEditorState> | null} baseline
 * @param {Partial<DayEditorState>} current
 */
export function isDayEditorDirty(baseline, current) {
  if (!baseline) return false
  const a = snapshotDayEditor(baseline)
  const b = snapshotDayEditor(current)
  // 休假不看時間、清潔日、Smoko：那些欄位這時不會被儲存
  if (a.shiftType === 'leave' && b.shiftType === 'leave') return a.remark !== b.remark
  return (
    a.shiftType !== b.shiftType ||
    a.startTime !== b.startTime ||
    a.endTime !== b.endTime ||
    a.isCleaningDay !== b.isCleaningDay ||
    a.remark !== b.remark ||
    a.smokoCountOverride !== b.smokoCountOverride
  )
}
