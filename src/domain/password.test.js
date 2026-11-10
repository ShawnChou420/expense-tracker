import { describe, expect, it } from 'vitest'
import { PASSWORD_RULE_TEXT, passwordChecks, passwordPolicyError } from './password.js'

describe('註冊密碼規則', () => {
  it('8 個字元且包含大寫、小寫、數字、特殊符號時通過', () => {
    expect(passwordPolicyError('Abcdef1!')).toBe('')
    expect(passwordPolicyError('MyPass#2026')).toBe('')
  })

  it('缺少任一條件時回傳規則說明', () => {
    expect(passwordPolicyError('Abcde1!')).toBe(PASSWORD_RULE_TEXT) // 只有 7 個字元
    expect(passwordPolicyError('abcdef1!')).toBe(PASSWORD_RULE_TEXT) // 沒有大寫
    expect(passwordPolicyError('ABCDEF1!')).toBe(PASSWORD_RULE_TEXT) // 沒有小寫
    expect(passwordPolicyError('Abcdefg!')).toBe(PASSWORD_RULE_TEXT) // 沒有數字
    expect(passwordPolicyError('Abcdefg1')).toBe(PASSWORD_RULE_TEXT) // 沒有特殊符號
    expect(passwordPolicyError('Abcdef1 ')).toBe(PASSWORD_RULE_TEXT) // 空白不算特殊符號
  })

  it('超過 128 個字元時拒絕', () => {
    expect(passwordPolicyError(`Aa1!${'x'.repeat(125)}`)).toBe('密碼最多 128 個字元')
  })

  it('逐項回報哪些條件已符合', () => {
    const result = Object.fromEntries(passwordChecks('abc1').map((c) => [c.key, c.ok]))
    expect(result).toEqual({ length: false, upper: false, lower: true, digit: true, symbol: false })
  })
})
