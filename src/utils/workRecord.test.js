import { describe, expect, it } from 'vitest'
import { normalizeWorkRecord } from './workRecord.js'

describe('designated work marker in WorkRecord', () => {
  it('preserves a marked day through JSON normalization', () => {
    const original = { id: 7, workDate: '2026-09-21', grossPay: 230, designatedWork: true }
    const imported = normalizeWorkRecord(JSON.parse(JSON.stringify(original)))
    expect(imported.designatedWork).toBe(true)
    expect(imported.grossPay).toBe(230)
  })

  it('defaults older unmarked JSON to false', () => {
    expect(normalizeWorkRecord({ workDate: '2026-09-21' }).designatedWork).toBe(false)
  })
})
