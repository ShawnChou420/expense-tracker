import { describe, expect, it } from 'vitest'
import { isDayEditorDirty, snapshotDayEditor } from './dayEditor.js'

const base = {
  startTime: '09:00',
  endTime: '17:00',
  shiftType: 'normal',
  isCleaningDay: false,
  remark: '',
  smokoCountOverride: null,
}

describe('isDayEditorDirty', () => {
  it('沒有基準值時不算修改', () => {
    expect(isDayEditorDirty(null, base)).toBe(false)
  })

  it('完全相同不算修改', () => {
    expect(isDayEditorDirty(base, { ...base })).toBe(false)
  })

  it.each([
    ['上班時間', { startTime: '09:30' }],
    ['下班時間', { endTime: '17:10' }],
    ['班別類型', { shiftType: 'leave' }],
    ['清潔日', { isCleaningDay: true }],
    ['備註', { remark: '感冒' }],
    ['Smoko 次數覆寫', { smokoCountOverride: 0 }],
  ])('改了%s 算修改', (_label, change) => {
    expect(isDayEditorDirty(base, { ...base, ...change })).toBe(true)
  })

  it('空白日期填上時間算修改', () => {
    const empty = snapshotDayEditor({})
    expect(isDayEditorDirty(empty, { ...empty, startTime: '09:00', endTime: '17:00' })).toBe(true)
  })

  it('改了又改回原值不算修改', () => {
    const current = { ...base, endTime: '18:00' }
    current.endTime = '17:00'
    expect(isDayEditorDirty(base, current)).toBe(false)
  })

  it('備註前後空白不算修改', () => {
    expect(isDayEditorDirty({ ...base, remark: '早退' }, { ...base, remark: ' 早退 ' })).toBe(false)
  })

  it('休假時只看備註', () => {
    const leave = { ...base, shiftType: 'leave' }
    expect(isDayEditorDirty(leave, { ...leave, startTime: '06:00', isCleaningDay: true })).toBe(
      false,
    )
    expect(isDayEditorDirty(leave, { ...leave, remark: '病假' })).toBe(true)
  })

  it('缺欄位與 undefined 視為預設值', () => {
    expect(
      isDayEditorDirty(
        { startTime: '', endTime: '' },
        { ...snapshotDayEditor({}), remark: undefined },
      ),
    ).toBe(false)
  })
})
