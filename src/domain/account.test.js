import { describe, expect, it } from 'vitest'
import {
  formatRegisteredDate,
  nicknameError,
  normalizeNickname,
  passwordChangeError,
} from './account.js'
import { PASSWORD_RULE_TEXT } from './password.js'

describe('顯示名稱', () => {
  it('去除前後空白，空白視為清除', () => {
    expect(normalizeNickname('  小周 ')).toBe('小周')
    expect(normalizeNickname('   ')).toBe('')
    expect(normalizeNickname(null)).toBe('')
  })

  it('最多 50 個字（中文與 emoji 以單一字元計）', () => {
    expect(nicknameError('名'.repeat(50))).toBe('')
    expect(nicknameError('😀'.repeat(50))).toBe('')
    expect(nicknameError('名'.repeat(51))).toBe('顯示名稱最多 50 個字')
  })

  it('拒絕控制字元', () => {
    expect(nicknameError('a\u0000b')).toBe('顯示名稱含有不支援的字元')
  })
})

describe('修改密碼表單', () => {
  const valid = {
    currentPassword: 'old-pass',
    newPassword: 'New#Pass1',
    confirmPassword: 'New#Pass1',
  }

  it('目前密碼不套用新規則，舊帳號仍可改密碼', () => {
    expect(passwordChangeError(valid)).toBe('')
  })

  it('依序檢查目前密碼、新密碼規則、確認與重複', () => {
    expect(passwordChangeError({ ...valid, currentPassword: '' })).toBe('請輸入目前密碼')
    expect(passwordChangeError({ ...valid, newPassword: 'weak', confirmPassword: 'weak' })).toBe(
      PASSWORD_RULE_TEXT,
    )
    expect(passwordChangeError({ ...valid, confirmPassword: 'New#Pass2' })).toBe(
      '兩次輸入的新密碼不一致',
    )
    expect(
      passwordChangeError({
        currentPassword: 'New#Pass1',
        newPassword: 'New#Pass1',
        confirmPassword: 'New#Pass1',
      }),
    ).toBe('新密碼不可與目前密碼相同')
  })
})

describe('註冊日期', () => {
  it('轉為本地日期，缺值或無效顯示「—」', () => {
    expect(formatRegisteredDate(new Date(2026, 10, 9, 23, 30).toISOString())).toBe('2026-11-09')
    expect(formatRegisteredDate(null)).toBe('—')
    expect(formatRegisteredDate('not-a-date')).toBe('—')
  })
})
